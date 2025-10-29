import { wait as delay } from "../../../core/utils/wait";
import {
  createScrollContainerDetector,
  type ScrollContainerDetectionOptions,
  type ScrollContainerDetector
} from "../../../core/utils/scroll/container";
import {
  createIntoViewScroller,
  type IntoViewAlignment,
  type IntoViewMargin,
  type IntoViewResult,
  type IntoViewScroller,
  type IntoViewTelemetry
} from "../../../core/utils/scroll/into-view";
import {
  createScrollTelemetryAdapter,
  type ScrollTelemetryEventEnvelope,
  type ScrollTelemetryLogger,
  type ScrollTelemetryNotifier
} from "../../../core/utils/scroll/telemetry";
import {
  createScrollUntilRunner,
  type ScrollUntilDependencies,
  type ScrollUntilPredicateContext,
  type ScrollUntilPredicateRegistry,
  type ScrollUntilPredicateResult,
  type ScrollUntilResult,
  type ScrollUntilRunOptions,
  type ScrollUntilStatus,
  type ScrollUntilTelemetry,
  type ScrollUntilTelemetryAttemptEvent,
  type ScrollUntilTelemetryCompleteEvent,
  type ScrollUntilTelemetryStartEvent
} from "../../../core/utils/scroll/until";
import type { ResolveResult } from "../../../core/resolve";
import { pushHudNotification } from "../../../menu/hud";
import {
  buildHandler,
  buildResult,
  isDomElement,
  maskValue,
  renderTemplate,
  sanitizeForLogging,
  sanitizeLogicalKey,
  summarizeElement,
  withEnvironment,
  type ActionExecutionArgs,
  type ActionRuntimeOptions
} from "./shared";
import { StepError, buildResolverMissError, type StepErrorReason } from "../engine/errors";
import type {
  ScrollIntoViewOptions,
  ScrollIntoViewStep,
  ScrollUntilOptions,
  ScrollUntilStep,
  ScrollUntilStopCondition,
  StepResult
} from "../types";

interface ScrollActionDependencies {
  containerDetector: ScrollContainerDetector;
  intoViewScroller: IntoViewScroller;
}

interface ScrollTelemetryOptions {
  logger?: ScrollTelemetryLogger | null;
  notify?: ScrollTelemetryNotifier;
  includeAttempts?: boolean;
  eventPrefix?: string;
  maskSelectors?: boolean;
}

const DEFAULT_SCROLL_TELEMETRY_PREFIX = "[DGX] scroll";

const BOOLEAN_TRUE_STRINGS = new Set(["true", "1", "yes", "on"]);

export function createScrollIntoViewHandler(options: ActionRuntimeOptions = {}): StepResultHandler {
  const deps = resolveScrollDependencies(options);
  return buildHandler<ScrollIntoViewStep>((args) => executeScrollIntoView(args, options, deps), options);
}

export function createScrollUntilHandler(options: ActionRuntimeOptions = {}): StepResultHandler {
  const deps = resolveScrollDependencies(options);
  return buildHandler<ScrollUntilStep>((args) => executeScrollUntil(args, options, deps), options);
}

export function createScrollHandlers(options: ActionRuntimeOptions = {}): Record<string, StepResultHandler> {
  return {
    scrollIntoView: createScrollIntoViewHandler(options),
    scrollUntil: createScrollUntilHandler(options)
  } satisfies Record<string, StepResultHandler>;
}

type StepResultHandler = (args: ActionExecutionArgs<any>) => Promise<StepResult> | StepResult;

async function executeScrollIntoView(
  args: ActionExecutionArgs<ScrollIntoViewStep>,
  runtime: ActionRuntimeOptions,
  deps: ScrollActionDependencies
): Promise<StepResult> {
  ensureNotAborted(args.signal);

  const step = args.step;
  const resolved = await args.resolveLogicalKey(step.key);
  const target = extractElement(resolved);

  if (!target) {
    throw buildResolverMissError(step, step.key, args.attempt, {
      strategies: resolved?.attempts?.map((attempt) => attempt.strategy) ?? []
    });
  }

  const options = step.options ?? {};
  const containerCache = new Map<string, Element | null>();

  if (options.containerKey) {
    const element = await resolveLogicalKeyElement(args, options.containerKey).catch(() => null);
    containerCache.set(options.containerKey, element);
  }

  if (Array.isArray(options.fallbackKeys)) {
    for (const key of options.fallbackKeys) {
      if (!key) {
        continue;
      }
      if (containerCache.has(key)) {
        continue;
      }
      const element = await resolveLogicalKeyElement(args, key).catch(() => null);
      containerCache.set(key, element);
    }
  }

  const explicitContainer = resolveExplicitContainer(options, containerCache);
  const detectionOptions = await buildContainerDetectionOptions(args, options, containerCache);

  const telemetry = createIntoViewTelemetry(args, runtime);

  const result = await deps.intoViewScroller.scrollIntoView(target, {
    container: explicitContainer,
    alignment: normalizeAlignment(options.alignment),
    margin: normalizeMargin(options.margin),
    maxRetries: typeof options.maxRetries === "number" ? Math.max(0, Math.floor(options.maxRetries)) : undefined,
    containerDetection: detectionOptions,
    telemetry
  });

  const payload = serializeIntoViewResult(result, {
    key: step.key,
    containerKey: options.containerKey,
    fallbackKeys: options.fallbackKeys,
    alignment: options.alignment,
    margin: options.margin
  });

  if (result.success) {
    return buildResult("success", {
      notes: step.name ?? "Scrolled into view",
      data: {
        scrollIntoView: payload
      }
    });
  }

  const reason = mapIntoViewFailureReason(result.reason);

  throw new StepError({
    reason,
    message: buildIntoViewFailureMessage(result.reason),
    stepKind: step.kind,
    stepId: step.id,
    logicalKey: step.key,
    attempts: result.attempts,
    data: {
      scrollIntoView: payload
    }
  });
}

async function executeScrollUntil(
  args: ActionExecutionArgs<ScrollUntilStep>,
  runtime: ActionRuntimeOptions,
  deps: ScrollActionDependencies
): Promise<StepResult> {
  ensureNotAborted(args.signal);

  const step = args.step;
  const options = step.options ?? ({} as ScrollUntilOptions);

  const containerCache = new Map<string, Element | null>();

  const resolveKey = async (key: string): Promise<Element | null> => {
    if (containerCache.has(key)) {
      return containerCache.get(key) ?? null;
    }
    const element = await resolveLogicalKeyElement(args, key).catch(() => null);
    containerCache.set(key, element);
    return element;
  };

  if (options.containerKey) {
    await resolveKey(options.containerKey);
  }

  if (Array.isArray(options.containerFallbackKeys)) {
    for (const key of options.containerFallbackKeys) {
      if (key) {
        await resolveKey(key);
      }
    }
  }

  const explicitContainer = await resolveExplicitContainer(options, containerCache);
  const anchorElement = await resolveAnchorElement(args, options);
  const detectionOptions = await buildContainerDetectionOptions(args, options, containerCache);

  const predicateRegistry = createScrollPredicateRegistry(args, runtime, options, {
    resolveKey,
    anchor: anchorElement,
    containerDetector: deps.containerDetector
  });

  const telemetry = createScrollTelemetry(args, runtime, options);

  const runner = createScrollUntilRunner(buildRunnerDependencies(runtime, predicateRegistry, deps, containerCache));

  const dslCondition = options.until;
  if (!dslCondition) {
    throw new StepError({
      reason: "unknown",
      message: "scrollUntil step missing 'until' condition",
      stepKind: step.kind,
      stepId: step.id
    });
  }

  const runOptions: ScrollUntilRunOptions = {
    until: mapStopCondition(dslCondition),
    container: explicitContainer,
    containerKey: options.containerKey,
    containerDetection: detectionOptions,
    anchor: anchorElement,
    stepPx: coalesceNumber(options.stepPx),
    maxAttempts: coalesceNumber(options.maxAttempts, options.maxSteps),
    delayMs: coalesceNumber(options.delayMs),
    timeoutMs: coalesceNumber(options.timeoutMs, step.timeoutMs),
    minDeltaPx: coalesceNumber(options.minDeltaPx),
    metadata: buildScrollMetadata(args, step, options),
    telemetry,
    signal: args.signal
  } satisfies ScrollUntilRunOptions;

  const result = await runner.run(runOptions);
  const payload = serializeScrollUntilResult(result, dslCondition, options);

  if (result.status === "success") {
    return buildResult("success", {
      notes: step.name ?? result.reason ?? "Scroll completed",
      data: {
        scrollUntil: payload
      }
    });
  }

  const reason = mapScrollFailureReason(result.status, result);

  if (result.status === "cancelled") {
    throw StepError.fromUnknown(step, "cancelled", new DOMException("Operation aborted", "AbortError"), {
      attempts: result.attempts,
      elapsedMs: result.elapsedMs,
      data: {
        scrollUntil: payload
      }
    });
  }

  throw new StepError({
    reason,
    message: buildScrollFailureMessage(result, reason),
    stepKind: step.kind,
    stepId: step.id,
    logicalKey: undefined,
    attempts: result.attempts,
    elapsedMs: result.elapsedMs,
    data: {
      scrollUntil: payload
    }
  });
}

function resolveScrollDependencies(options: ActionRuntimeOptions): ScrollActionDependencies {
  const detector = options.scroll?.containerDetector ?? createScrollContainerDetector();
  const scroller = options.scroll?.intoViewScroller ?? createIntoViewScroller({ containerDetector: detector });
  return {
    containerDetector: detector,
    intoViewScroller: scroller
  } satisfies ScrollActionDependencies;
}

function mapStopCondition(condition: ScrollUntilStopCondition) {
  switch (condition.kind) {
    case "end":
      return {
        kind: "end",
        thresholdPx: condition.thresholdPx
      } as const;
    case "element":
      return {
        kind: "element",
        key: condition.key,
        css: condition.css,
        xpath: condition.xpath
      } as const;
    case "listGrowth":
      return {
        kind: "list-growth",
        parentKey: condition.parentKey,
        itemCss: condition.itemCss,
        minDelta: condition.minDelta
      } as const;
    case "predicate":
      return {
        kind: "predicate",
        id: condition.id
      } as const;
    default: {
      const exhaustive: never = condition;
      return {
        kind: "end"
      } as const;
    }
  }
}

function mapIntoViewFailureReason(reason?: string | null): StepErrorReason {
  switch (reason) {
    case "container-unavailable":
      return "container_unavailable";
    case "max-retries":
      return "timeout";
    case "no-adjustment":
      return "no_change";
    case "invalid-target":
      return "resolver-miss";
    default:
      return "unknown";
  }
}

function buildIntoViewFailureMessage(reason?: string | null): string {
  switch (reason) {
    case "container-unavailable":
      return "Unable to resolve scroll container";
    case "max-retries":
      return "Scroll into view exceeded retry limit";
    case "no-adjustment":
      return "Target already within view; no scroll performed";
    case "invalid-target":
      return "Unable to resolve target element";
    default:
      return "Scroll into view failed";
  }
}

function mapScrollFailureReason(status: ScrollUntilStatus, result: ScrollUntilResult): StepErrorReason {
  switch (status) {
    case "timeout":
      return "timeout";
    case "no_change":
      return result.domStable ? "dom_stable_no_match" : "no_change";
    case "predicate_error":
      return "predicate_error";
    case "container_unavailable":
      return "container_unavailable";
    case "cancelled":
      return "cancelled";
    default:
      return "unknown";
  }
}

function buildScrollFailureMessage(result: ScrollUntilResult, reason: StepErrorReason): string {
  const base = result.reason ?? reason;
  switch (result.status) {
    case "timeout":
      return `scrollUntil timed out (${base})`;
    case "no_change":
      return `scrollUntil stopped after no change (${base})`;
    case "predicate_error":
      return `scrollUntil predicate failed (${base})`;
    case "container_unavailable":
      return "scrollUntil could not resolve container";
    case "cancelled":
      return "scrollUntil was cancelled";
    default:
      return `scrollUntil failed (${base})`;
  }
}

function serializeIntoViewResult(
  result: IntoViewResult,
  context: {
    key: string;
    containerKey?: string;
    fallbackKeys?: string[];
    alignment?: IntoViewAlignment;
    margin?: number | IntoViewMargin;
  }
): Record<string, unknown> {
  return sanitizeForLogging({
    success: result.success,
    attempts: result.attempts,
    reason: result.reason ?? null,
    container: summarizeElement(result.container),
    target: summarizeElement(result.target),
    key: sanitizeLogicalKey(context.key),
    containerKey: sanitizeLogicalKey(context.containerKey),
    fallbackKeys: context.fallbackKeys?.map((key) => sanitizeLogicalKey(key)),
    alignment: context.alignment,
    margin: context.margin
  }) as Record<string, unknown>;
}

function serializeScrollUntilResult(
  result: ScrollUntilResult,
  condition: ScrollUntilStopCondition,
  options: ScrollUntilOptions
): Record<string, unknown> {
  return sanitizeForLogging({
    status: result.status,
    attempts: result.attempts,
    elapsedMs: result.elapsedMs,
    reason: result.reason ?? null,
    consecutiveNoChange: result.consecutiveNoChange,
    domStable: result.domStable ?? false,
    lastDelta: result.lastDelta,
    cumulativeDelta: result.cumulativeDelta,
    container: summarizeElement(result.container),
    predicateSnapshot: result.predicateSnapshot ?? null,
    metadata: result.metadata ?? null,
    config: result.config,
    condition,
    options
  }) as Record<string, unknown>;
}

async function resolveExplicitContainer(
  options: ScrollIntoViewOptions | ScrollUntilOptions,
  cache: Map<string, Element | null>
): Promise<Element | null> {
  if (options.containerKey && cache.has(options.containerKey)) {
    return cache.get(options.containerKey) ?? null;
  }

  if (options.containerCss && typeof document !== "undefined") {
    try {
      const element = document.querySelector(options.containerCss);
      if (isDomElement(element)) {
        return element;
      }
    } catch {
      // ignore selector errors
    }
  }

  if (options.containerXPath && typeof document !== "undefined") {
    try {
      const doc = document;
      const result = doc.evaluate(options.containerXPath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      const element = result.singleNodeValue;
      if (isDomElement(element)) {
        return element;
      }
    } catch {
      // ignore xpath errors
    }
  }

  return null;
}

async function resolveAnchorElement(
  args: ActionExecutionArgs<ScrollUntilStep>,
  options: ScrollUntilOptions
): Promise<Element | null> {
  if (options.anchorKey) {
    const resolved = await resolveLogicalKeyElement(args, options.anchorKey).catch(() => null);
    if (resolved) {
      return resolved;
    }
  }

  if (options.anchorCss && typeof document !== "undefined") {
    try {
      const element = document.querySelector(options.anchorCss);
      if (isDomElement(element)) {
        return element;
      }
    } catch {
      // ignore selector errors
    }
  }

  if (options.anchorXPath && typeof document !== "undefined") {
    try {
      const doc = document;
      const result = doc.evaluate(options.anchorXPath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      const element = result.singleNodeValue;
      if (isDomElement(element)) {
        return element;
      }
    } catch {
      // ignore xpath errors
    }
  }

  return null;
}

async function buildContainerDetectionOptions(
  args: ActionExecutionArgs<any>,
  options: ScrollIntoViewOptions | ScrollUntilOptions,
  cache: Map<string, Element | null>
): Promise<ScrollContainerDetectionOptions | undefined> {
  const hints = Array.isArray(options.detectionHints) && options.detectionHints.length > 0
    ? { attributeNames: options.detectionHints }
    : undefined;

  const fallbackElements: Element[] = [];
  if (options.containerKey) {
    const element = cache.get(options.containerKey);
    if (isDomElement(element)) {
      fallbackElements.push(element);
    }
  }
  if (Array.isArray(options.containerFallbackKeys)) {
    for (const key of options.containerFallbackKeys) {
      const element = cache.get(key ?? "");
      if (isDomElement(element)) {
        fallbackElements.push(element);
      }
    }
  }

  if (!hints && fallbackElements.length === 0) {
    return undefined;
  }

  return {
    hints,
    context: fallbackElements.length > 0 ? { fallbackElements } : undefined
  } satisfies ScrollContainerDetectionOptions;
}

function createIntoViewTelemetry(
  args: ActionExecutionArgs<ScrollIntoViewStep>,
  runtime: ActionRuntimeOptions
): IntoViewTelemetry | null {
  const logger = args.logger;
  if (!logger) {
    return null;
  }

  return {
    onAdjustment(event) {
      logger.debug?.("[DGX] scrollIntoView:adjustment", sanitizeForLogging({
        runId: args.runId,
        stepId: args.step.id,
        attempt: event.attempt,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        alignment: event.alignment,
        margin: event.margin,
        container: summarizeElement(event.container),
        target: summarizeElement(event.target)
      }) as Record<string, unknown>);
    },
    onSettle(event) {
      const level = event.success ? "info" : "warn";
      const description = sanitizeForLogging({
        runId: args.runId,
        stepId: args.step.id,
        attempts: event.attempts,
        success: event.success,
        reason: event.reason ?? null,
        container: summarizeElement(event.container),
        target: summarizeElement(event.target)
      }) as Record<string, unknown>;
      if (event.success) {
        logger.info?.("[DGX] scrollIntoView:settle", description);
      } else {
        logger.warn?.("[DGX] scrollIntoView:settle", description);
      }
    }
  } satisfies IntoViewTelemetry;
}

function createScrollTelemetry(
  args: ActionExecutionArgs<ScrollUntilStep>,
  runtime: ActionRuntimeOptions,
  options: ScrollUntilOptions
): ScrollUntilTelemetry {
  const telemetryOptions: ScrollTelemetryOptions = {
    logger: runtime.scroll?.telemetry?.logger ?? args.logger ?? undefined,
    notify: runtime.scroll?.telemetry?.notify,
    includeAttempts: options.telemetry?.includeAttempts ?? runtime.scroll?.telemetry?.includeAttempts ?? false,
    eventPrefix: options.telemetry?.eventPrefix ?? runtime.scroll?.telemetry?.eventPrefix ?? DEFAULT_SCROLL_TELEMETRY_PREFIX,
    maskSelectors: runtime.scroll?.telemetry?.maskSelectors ?? true
  } satisfies ScrollTelemetryOptions;

  const notify = telemetryOptions.notify ?? createScrollHudNotifier(args);

  return createScrollTelemetryAdapter({
    basePayload: buildTelemetryBasePayload(args),
    logger: telemetryOptions.logger ?? undefined,
    notify,
    includeAttempts: telemetryOptions.includeAttempts ?? false,
    eventPrefix: telemetryOptions.eventPrefix,
    maskSelectors: telemetryOptions.maskSelectors ?? true
  });
}

function createScrollHudNotifier(args: ActionExecutionArgs<ScrollUntilStep>): ScrollTelemetryNotifier {
  return (envelope: ScrollTelemetryEventEnvelope) => {
    if (envelope.kind === "attempt") {
      return;
    }

    const payload = sanitizeForLogging({
      ...envelope.payload,
      runId: args.runId,
      stepId: args.step.id,
      workflowId: args.workflowId,
      eventKind: envelope.kind
    }) as Record<string, unknown>;

    const summary = buildTelemetrySummary(envelope, args);

    pushHudNotification({
      id: `scroll-${args.runId}-${args.step.id}-${envelope.kind}-${Date.now()}`,
      title: `${DEFAULT_SCROLL_TELEMETRY_PREFIX}:${envelope.kind}`,
      level: mapTelemetryLevel(envelope.level),
      description: summary,
      metadata: payload
    });
  };
}

function buildTelemetryBasePayload(args: ActionExecutionArgs<ScrollUntilStep>): Record<string, unknown> {
  return {
    runId: args.runId,
    workflowId: args.workflowId,
    stepId: args.step.id,
    stepName: args.step.name,
    stepKind: args.step.kind
  } satisfies Record<string, unknown>;
}

function buildTelemetrySummary(envelope: ScrollTelemetryEventEnvelope, args: ActionExecutionArgs<ScrollUntilStep>): string {
  const payload = envelope.payload;
  const parts = [
    `run: ${args.runId}`,
    `step: ${args.step.id}`,
    `event: ${envelope.kind}`
  ];

  if (typeof payload.attempt === "number") {
    parts.push(`attempt: ${payload.attempt}`);
  }

  if (typeof payload.elapsedMs === "number") {
    parts.push(`elapsed: ${payload.elapsedMs}ms`);
  }

  if (typeof payload.reason === "string" && payload.reason.length > 0) {
    parts.push(`reason: ${payload.reason}`);
  }

  return parts.join(" • ");
}

function mapTelemetryLevel(level: ScrollTelemetryEventEnvelope["level"]): "info" | "warn" | "error" {
  if (level === "error") {
    return "error";
  }
  if (level === "warn") {
    return "warn";
  }
  return "info";
}

function buildRunnerDependencies(
  runtime: ActionRuntimeOptions,
  predicateRegistry: ScrollUntilPredicateRegistry,
  deps: ScrollActionDependencies,
  cache: Map<string, Element | null>
): ScrollUntilDependencies {
  const logger = runtime.scroll?.telemetry?.logger ?? undefined;

  return {
    predicateRegistry,
    containerDetector: deps.containerDetector,
    resolveContainerKey: (key: string) => cache.get(key) ?? null,
    defaults: runtime.scroll?.defaults,
    sleep: (ms, signal) => delay(ms ?? 0, { signal }),
    logger: logger ?? undefined,
    runIdFactory: runtime.scroll?.runIdFactory
  } satisfies ScrollUntilDependencies;
}

function createScrollPredicateRegistry(
  args: ActionExecutionArgs<ScrollUntilStep>,
  runtime: ActionRuntimeOptions,
  options: ScrollUntilOptions,
  dependencies: {
    resolveKey: (key: string) => Promise<Element | null>;
    anchor: Element | null;
    containerDetector: ScrollContainerDetector;
  }
): ScrollUntilPredicateRegistry {
  const listState = {
    baseline: 0,
    lastCount: 0,
    container: null as Element | null
  };

  const predicateEvaluator = runtime.scroll?.predicateEvaluator;

  return {
    async evaluate(condition, context) {
      switch (condition.kind) {
        case "end":
          return evaluateEndPredicate(condition, context);
        case "element":
          return evaluateElementPredicate(args, condition, context);
        case "list-growth":
          return evaluateListGrowthPredicate(args, condition, context, options, listState);
        case "predicate":
          return evaluateCustomPredicate(args, options, condition, context, predicateEvaluator);
        default:
          return { satisfied: false } satisfies ScrollUntilPredicateResult;
      }
    }
  } satisfies ScrollUntilPredicateRegistry;
}

function evaluateEndPredicate(
  condition: { kind: "end"; thresholdPx?: number },
  context: ScrollUntilPredicateContext
): ScrollUntilPredicateResult {
  const snapshot = context.containerSnapshot;
  if (!snapshot) {
    return { satisfied: false, reason: "missing-container-snapshot" } satisfies ScrollUntilPredicateResult;
  }

  const threshold = typeof condition.thresholdPx === "number" && Number.isFinite(condition.thresholdPx)
    ? Math.max(0, condition.thresholdPx)
    : 2;

  const remaining = snapshot.maxScrollTop - snapshot.scrollTop;
  const satisfied = remaining <= threshold;

  return {
    satisfied,
    reason: satisfied ? "end-reached" : "scrolling",
    snapshot: {
      scrollTop: snapshot.scrollTop,
      maxScrollTop: snapshot.maxScrollTop,
      remaining
    }
  } satisfies ScrollUntilPredicateResult;
}

async function evaluateElementPredicate(
  args: ActionExecutionArgs<ScrollUntilStep>,
  condition: { kind: "element"; key?: string; css?: string; xpath?: string; requireVisible?: boolean },
  context: ScrollUntilPredicateContext
): Promise<ScrollUntilPredicateResult> {
  let resolved: ResolveResult | null = null;
  let element: Element | null = null;
  let errorReason: string | undefined;

  try {
    if (condition.key) {
      resolved = await args.resolveLogicalKey(condition.key);
      element = extractElement(resolved) ?? null;
    } else if (condition.css && typeof document !== "undefined") {
      element = document.querySelector(condition.css) ?? null;
    } else if (condition.xpath && typeof document !== "undefined") {
      const doc = document;
      const result = doc.evaluate(condition.xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      const candidate = result.singleNodeValue;
      if (isDomElement(candidate)) {
        element = candidate;
      }
    }
  } catch (error) {
    errorReason = error instanceof Error ? error.message : "resolver-error";
  }

  if (!element) {
    return {
      satisfied: false,
      reason: errorReason ?? "resolver_miss",
      snapshot: resolved ? sanitizeResolveResult(resolved) : undefined
    } satisfies ScrollUntilPredicateResult;
  }

  if (condition.requireVisible && !isElementVisible(element)) {
    return {
      satisfied: false,
      reason: "element-hidden",
      snapshot: resolved ? sanitizeResolveResult(resolved) : undefined
    } satisfies ScrollUntilPredicateResult;
  }

  if (context.container && !isElementWithinContainer(element, context.container)) {
    return {
      satisfied: false,
      reason: "element-out-of-view",
      snapshot: resolved ? sanitizeResolveResult(resolved) : undefined
    } satisfies ScrollUntilPredicateResult;
  }

  return {
    satisfied: true,
    reason: "element-visible",
    snapshot: resolved ? sanitizeResolveResult(resolved) : undefined
  } satisfies ScrollUntilPredicateResult;
}

async function evaluateListGrowthPredicate(
  args: ActionExecutionArgs<ScrollUntilStep>,
  condition: { kind: "list-growth"; parentKey?: string; itemCss?: string; minDelta?: number },
  context: ScrollUntilPredicateContext,
  options: ScrollUntilOptions,
  state: { baseline: number; lastCount: number; container: Element | null }
): Promise<ScrollUntilPredicateResult> {
  let container = state.container;

  if (!container) {
    if (condition.parentKey) {
      container = await resolveLogicalKeyElement(args, condition.parentKey).catch(() => null);
    }

    if (!container && context.container) {
      container = context.container;
    }

    state.container = container;
  }

  if (!container) {
    return {
      satisfied: false,
      reason: "container-missing"
    } satisfies ScrollUntilPredicateResult;
  }

  const selector = condition.itemCss ?? "*";
  let count = 0;

  try {
    if (selector === "*") {
      count = container.children.length;
    } else {
      count = container.querySelectorAll(selector).length;
    }
  } catch {
    count = container.children.length;
  }

  if (state.baseline === 0) {
    state.baseline = count;
  }

  state.lastCount = count;

  const minDelta = typeof condition.minDelta === "number" && Number.isFinite(condition.minDelta)
    ? Math.max(1, Math.floor(condition.minDelta))
    : 1;

  const delta = count - state.baseline;
  const satisfied = delta >= minDelta;

  return {
    satisfied,
    reason: satisfied ? "list-growth-achieved" : "list-growth-waiting",
    snapshot: {
      baseline: state.baseline,
      current: count,
      delta,
      selector,
      minDelta
    }
  } satisfies ScrollUntilPredicateResult;
}

async function evaluateCustomPredicate(
  args: ActionExecutionArgs<ScrollUntilStep>,
  options: ScrollUntilOptions,
  condition: { kind: "predicate"; id?: string; expression?: string; ctxPath?: string },
  context: ScrollUntilPredicateContext,
  evaluator?: (
    expression: string,
    input: {
      attempt: number;
      elapsedMs: number;
      container: Element;
      cumulativeDelta: { x: number; y: number };
      metadata?: Record<string, unknown>;
    }
  ) => boolean | Promise<boolean>
): Promise<ScrollUntilPredicateResult> {
  if (!context.container) {
    return {
      satisfied: false,
      reason: "container-missing"
    } satisfies ScrollUntilPredicateResult;
  }

  let expression = condition.expression ?? "";

  if (!expression && condition.ctxPath) {
    const value = args.context.get(condition.ctxPath);
    expression = typeof value === "string" ? value : String(value ?? "");
  }

  expression = expression ?? "";

  try {
    if (evaluator) {
      const satisfied = await evaluator(expression, {
        attempt: context.attempt,
        elapsedMs: context.elapsedMs,
        container: context.container,
        cumulativeDelta: context.cumulativeDelta,
        metadata: context.metadata ?? options.metadata
      });

      return {
        satisfied: Boolean(satisfied),
        reason: satisfied ? "predicate-satisfied" : "predicate-unsatisfied"
      } satisfies ScrollUntilPredicateResult;
    }

    const rendered = renderTemplate(expression, withEnvironment(args, runtime.environment));
    const normalized = rendered.trim().toLowerCase();
    const satisfied = BOOLEAN_TRUE_STRINGS.has(normalized);

    return {
      satisfied,
      reason: satisfied ? "predicate-satisfied" : "predicate-unsatisfied",
      snapshot: {
        expression,
        rendered
      }
    } satisfies ScrollUntilPredicateResult;
  } catch (error) {
    return {
      satisfied: false,
      reason: error instanceof Error ? error.message : "predicate-error"
    } satisfies ScrollUntilPredicateResult;
  }
}

function isElementVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) {
    return true;
  }

  const style = globalThis.getComputedStyle?.(element);
  if (!style) {
    return true;
  }

  return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
}

function isElementWithinContainer(element: Element, container: Element): boolean {
  if (element === container) {
    return true;
  }

  if (typeof container.contains === "function") {
    return container.contains(element);
  }

  return false;
}

function sanitizeResolveResult(result: ResolveResult): Record<string, unknown> {
  return sanitizeForLogging({
    key: sanitizeLogicalKey(result.key),
    attempts: result.attempts.map((attempt) => ({
      strategy: attempt.strategy,
      success: attempt.success,
      elementCount: attempt.elements.length
    })),
    resolvedBy: result.resolvedBy?.type ?? null
  }) as Record<string, unknown>;
}

async function resolveLogicalKeyElement(
  args: ActionExecutionArgs<any>,
  key: string
): Promise<Element | null> {
  const resolved = await args.resolveLogicalKey(key);
  return extractElement(resolved);
}

function extractElement(resolved: ResolveResult | null): Element | null {
  if (!resolved) {
    return null;
  }

  const element = resolved.element;
  return isDomElement(element) ? (element as Element) : null;
}

function normalizeAlignment(alignment?: IntoViewAlignment): IntoViewAlignment | undefined {
  if (!alignment) {
    return undefined;
  }

  return {
    block: alignment.block,
    inline: alignment.inline
  } satisfies IntoViewAlignment;
}

function normalizeMargin(margin?: number | IntoViewMargin): number | IntoViewMargin | undefined {
  if (typeof margin === "number") {
    return margin;
  }

  if (margin && typeof margin === "object") {
    return {
      top: toFiniteNumber(margin.top),
      right: toFiniteNumber(margin.right),
      bottom: toFiniteNumber(margin.bottom),
      left: toFiniteNumber(margin.left)
    } satisfies IntoViewMargin;
  }

  return undefined;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

function coalesceNumber(...values: Array<number | undefined | null>): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function ensureNotAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("Operation aborted", "AbortError");
  }
}
