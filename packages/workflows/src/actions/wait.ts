import {
  DEFAULT_WAIT_INTERVAL_MS,
  DEFAULT_WAIT_TIMEOUT_MS,
  createWaitHelpers,
  createWaitTelemetryAdapter,
  wait as delay,
  type WaitError,
  type WaitForOptions,
  type WaitHint,
  type WaitHelpers,
  type WaitHelpersDependencies,
  type WaitLogger,
  type WaitOptions,
  type WaitResult,
  type WaitTelemetry,
  type WaitTelemetryAttemptEvent,
  type WaitTelemetryEventEnvelope,
  type WaitTelemetryNotifier,
  type WaitTelemetryFailureEvent,
  type WaitTelemetryHeartbeatEvent,
  type WaitTelemetrySerializerOptions,
  type WaitTelemetryStartEvent,
  type WaitTelemetrySuccessEvent,
  type WaitTextOptions,
  type WaitVisibilityOptions,
  type WaitIdleOptions,
  type WaitResolver,
  type WaitResolverOptions
} from "../../../core/utils/wait";
import type { ResolveAttempt, ResolveResult } from "../../../core/resolve";
import type { QueryRoot } from "../../../core/utils/dom";
import type { SelectorTry } from "../../../selectors/types";
import type { ActionExecutionArgs, ActionRuntimeOptions } from "./shared";
import {
  maskValue,
  SENSITIVE_KEY_PATTERN,
  sanitizeForLogging,
  sanitizeLogicalKey,
  summarizeElement,
  isDomElement
} from "./shared";
import { pushHudNotification } from "../../../menu/hud";
import type { WorkflowStep } from "../types";
import { StepError } from "../engine/errors";

type WaitExecutionOutcome<TOptions extends WaitOptions = WaitOptions> = {
  result: WaitResult;
  options: TOptions;
};

export type WaitActionKind = "waitFor" | "waitText" | "waitVisible" | "waitHidden" | "waitForIdle";

export async function runWait<TStep extends WorkflowStep, TOptions extends WaitOptions>(
  kind: WaitActionKind,
  args: ActionExecutionArgs<TStep>,
  runtime: ActionRuntimeOptions,
  options: TOptions
): Promise<WaitExecutionOutcome<TOptions>> {
  const helpers = createWaitHelpersForStep(args, runtime);
  const waitOptions = buildWaitOptions(args, options);

  try {
    let waitResult: WaitResult;

    switch (kind) {
      case "waitFor":
        waitResult = await helpers.waitFor(waitOptions as WaitForOptions);
        break;
      case "waitText":
        waitResult = await helpers.waitText(waitOptions as WaitTextOptions);
        break;
      case "waitVisible":
        waitResult = await helpers.waitVisible(waitOptions as WaitVisibilityOptions);
        break;
      case "waitHidden":
        waitResult = await helpers.waitHidden(waitOptions as WaitVisibilityOptions);
        break;
      case "waitForIdle":
        waitResult = await helpers.waitForIdle(waitOptions as WaitIdleOptions);
        break;
      default:
        throw new StepError({
          reason: "unknown",
          message: `Unsupported wait kind '${String(kind)}'`,
          stepKind: args.step.kind,
          stepId: args.step.id
        });
    }

    return {
      result: waitResult,
      options: waitOptions
    } satisfies WaitExecutionOutcome<TOptions>;
  } catch (error) {
    throw toStepError(args.step, error, waitOptions);
  }
}

export function serializeWaitResult(result: WaitResult, options?: WaitOptions): Record<string, unknown> {
  const metadata = buildWaitMetadata(options);
  const sanitizedMetadata = metadata ? sanitizeForLogging(metadata) as Record<string, unknown> : undefined;
  const guidance = buildWaitSuccessGuidance(result, metadata);

  return {
    key: sanitizeLogicalKey(result.key),
    pollCount: result.pollCount,
    elapsedMs: result.elapsedMs,
    strategyHistory: [...result.strategyHistory],
    finalStrategy: result.strategyHistory[result.strategyHistory.length - 1] ?? null,
    staleRecoveries: result.staleRecoveries,
    predicateSnapshot: result.predicateSnapshot ? { ...result.predicateSnapshot } : undefined,
    idleSnapshot: result.idleSnapshot ? { ...result.idleSnapshot } : undefined,
    resolveResult: summarizeResolveResult(result.resolveResult),
    target: summarizeElement(result.target ?? result.resolveResult.element ?? null),
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    metadata: sanitizedMetadata,
    guidance: guidance ?? undefined
  } satisfies Record<string, unknown>;
}

function createWaitHelpersForStep<TStep extends WorkflowStep>(
  args: ActionExecutionArgs<TStep>,
  _runtime: ActionRuntimeOptions
): WaitHelpers {
  const debugEnabled = Boolean((args.step as { debug?: boolean }).debug);

  const dependencies: WaitHelpersDependencies = {
    resolver: createWaitResolver(args),
    logger: createWaitLogger(args),
    telemetry: createWaitTelemetry(args, debugEnabled),
    clock: { now: () => Date.now() },
    random: Math.random,
    sleep: (ms, signal) => delay(ms, { signal })
  } satisfies WaitHelpersDependencies;

  return createWaitHelpers(dependencies);
}

function createWaitResolver<TStep extends WorkflowStep>(args: ActionExecutionArgs<TStep>): WaitResolver {
  const stepKey = getStepLogicalKey(args.step);
  const initialResult = args.resolveResult ? cloneResolveResult(args.resolveResult) : null;
  let initialConsumed = false;

  return {
    async resolve(key: string, options?: WaitResolverOptions): Promise<ResolveResult> {
      if (!initialConsumed && initialResult && stepKey && key === stepKey && !options?.scope) {
        initialConsumed = true;
        return applyScopeFilter(cloneResolveResult(initialResult), options?.scope);
      }

      if (options?.signal?.aborted) {
        throw buildAbortError(options.signal);
      }

      const resolved = await args.resolveLogicalKey(key);
      const cloned = cloneResolveResult(resolved);

      if (options?.signal?.aborted) {
        throw buildAbortError(options.signal);
      }

      return applyScopeFilter(cloned, options?.scope);
    }
  } satisfies WaitResolver;
}

function createWaitLogger<TStep extends WorkflowStep>(args: ActionExecutionArgs<TStep>): WaitLogger | undefined {
  const logger = args.logger;

  if (!logger) {
    return undefined;
  }

  const base = buildLogBase(args);

  return {
    debug(message, data) {
      logger.debug?.(`[DGX] ${message}`, mergeLogPayload(base, data));
    },
    info(message, data) {
      logger.info?.(`[DGX] ${message}`, mergeLogPayload(base, data));
    },
    warn(message, data) {
      logger.warn?.(`[DGX] ${message}`, mergeLogPayload(base, data));
    },
    error(message, data) {
      logger.error?.(`[DGX] ${message}`, mergeLogPayload(base, data));
    }
  } satisfies WaitLogger;
}

function createWaitTelemetry<TStep extends WorkflowStep>(
  args: ActionExecutionArgs<TStep>,
  debugEnabled: boolean
): WaitTelemetry | null {
  const logger = args.logger;

  if (!logger) {
    return null;
  }

  const base = buildLogBase(args);

  return createWaitTelemetryAdapter({
    logger,
    basePayload: base,
    debug: debugEnabled,
    serializers: buildWaitTelemetrySerializers(args),
    transformPayload(payload) {
      return sanitizeTelemetryPayload(payload);
    },
    notify: buildWaitHudNotifier(args, base),
    buildFailureNarrative(error) {
      return buildWaitFailureNarrative(error);
    }
  });
}

function buildWaitTelemetrySerializers<TStep extends WorkflowStep>(
  _args: ActionExecutionArgs<TStep>
): WaitTelemetrySerializerOptions {
  return {
    start: serializeWaitStartEvent,
    attempt: serializeWaitAttemptEvent,
    heartbeat: serializeWaitHeartbeatEvent,
    success: serializeWaitSuccessEvent,
    failure: serializeWaitFailureEvent
  } satisfies WaitTelemetrySerializerOptions;
}

function serializeWaitStartEvent(event: WaitTelemetryStartEvent): Record<string, unknown> {
  return {
    key: sanitizeLogicalKey(event.key),
    timeoutMs: event.timeoutMs,
    intervalMs: event.intervalMs,
    startedAt: event.startedAt,
    metadata: event.metadata ? { ...event.metadata } : undefined
  } satisfies Record<string, unknown>;
}

function serializeWaitAttemptEvent(event: WaitTelemetryAttemptEvent): Record<string, unknown> {
  return {
    key: sanitizeLogicalKey(event.key),
    timeoutMs: event.timeoutMs,
    intervalMs: event.intervalMs,
    pollCount: event.pollCount,
    elapsedMs: event.elapsedMs,
    strategyHistory: [...event.strategyHistory],
    success: event.success,
    metadata: event.metadata ? { ...event.metadata } : undefined
  } satisfies Record<string, unknown>;
}

function serializeWaitHeartbeatEvent(event: WaitTelemetryHeartbeatEvent): Record<string, unknown> {
  return {
    key: sanitizeLogicalKey(event.key),
    timeoutMs: event.timeoutMs,
    intervalMs: event.intervalMs,
    pollCount: event.pollCount,
    elapsedMs: event.elapsedMs,
    remainingMs: event.remainingMs,
    staleRecoveries: event.staleRecoveries,
    predicateSnapshot: event.predicateSnapshot,
    metadata: event.metadata ? { ...event.metadata } : undefined
  } satisfies Record<string, unknown>;
}

function serializeWaitSuccessEvent(event: WaitTelemetrySuccessEvent): Record<string, unknown> {
  const resultPayload = serializeWaitResult(event.result);

  return {
    key: resultPayload.key,
    timeoutMs: event.timeoutMs,
    intervalMs: event.intervalMs,
    pollCount: resultPayload.pollCount,
    elapsedMs: resultPayload.elapsedMs,
    strategyHistory: resultPayload.strategyHistory,
    staleRecoveries: resultPayload.staleRecoveries,
    predicateSnapshot: resultPayload.predicateSnapshot,
    idleSnapshot: resultPayload.idleSnapshot,
    metadata: event.metadata ? { ...event.metadata } : undefined,
    result: resultPayload
  } satisfies Record<string, unknown>;
}

function serializeWaitFailureEvent(event: WaitTelemetryFailureEvent): Record<string, unknown> {
  const errorPayload = serializeWaitError(event.error);
  const guidance = ((errorPayload.wait as Record<string, unknown>)?.guidance ?? null) as string | null;

  return {
    key: sanitizeLogicalKey(event.error.key),
    timeoutMs: event.timeoutMs,
    intervalMs: event.intervalMs,
    pollCount: event.error.pollCount,
    elapsedMs: event.error.elapsedMs,
    strategyHistory: [...event.error.strategyHistory],
    staleRecoveries: event.error.staleRecoveries ?? 0,
    metadata: event.metadata ? { ...event.metadata } : undefined,
    error: errorPayload,
    guidance
  } satisfies Record<string, unknown>;
}

function sanitizeTelemetryPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const sanitized = sanitizeForLogging(payload) as Record<string, unknown>;
  const maskedKey = sanitizeLogicalKey(resolveTelemetryKey(payload));

  if (typeof maskedKey !== "undefined") {
    sanitized.key = maskedKey;
    sanitized.logicalKey = maskedKey;
  }

  return sanitized;
}

function resolveTelemetryKey(payload: Record<string, unknown>): string | undefined {
  const candidate = payload.key;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

function buildWaitHudNotifier<TStep extends WorkflowStep>(
  args: ActionExecutionArgs<TStep>,
  base: Record<string, unknown>
): WaitTelemetryNotifier {
  return (envelope: WaitTelemetryEventEnvelope) => {
    if (envelope.kind === "attempt") {
      return;
    }

    const payload = envelope.payload;
    const summaryParts = [
      `run: ${args.runId}`,
      `workflow: ${args.workflowId}`,
      `step: ${args.step.id}`,
      `event: ${envelope.kind}`
    ];

    if (typeof payload.pollCount === "number") {
      summaryParts.push(`polls: ${payload.pollCount}`);
    }

    if (typeof payload.elapsedMs === "number") {
      summaryParts.push(`elapsed: ${payload.elapsedMs}ms`);
    }

    if (typeof payload.timeoutMs === "number") {
      summaryParts.push(`timeout: ${payload.timeoutMs}ms`);
    }

    const baseLine = summaryParts.join(" • ");
    const narrative = typeof payload.narrative === "string" ? payload.narrative : undefined;
    const description = narrative ? `${baseLine}\n${narrative}` : baseLine;

    const metadata = sanitizeForLogging({
      ...base,
      ...payload,
      eventKind: envelope.kind
    }) as Record<string, unknown>;

    pushHudNotification({
      id: `wait-${args.runId}-${args.step.id}-${envelope.kind}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      title: `[DGX] wait:${envelope.kind}`,
      level: mapTelemetryLevelToHud(envelope.level),
      description,
      metadata
    });
  };
}

function mapTelemetryLevelToHud(level: WaitTelemetryEventEnvelope["level"]): "info" | "warn" | "error" {
  if (level === "error") {
    return "error";
  }

  if (level === "warn") {
    return "warn";
  }

  return "info";
}

function buildWaitFailureNarrative(error: WaitError): string {
  const message = buildWaitErrorMessage(error);
  const guidance = buildGuidance(error.code);
  return guidance ? `${message}. Guidance: ${guidance}` : message;
}

function buildWaitOptions<TStep extends WorkflowStep, TOptions extends WaitOptions>(
  args: ActionExecutionArgs<TStep>,
  options: TOptions
): TOptions {
  const metadata = args.step as { timeoutMs?: number; intervalMs?: number; debug?: boolean };
  const telemetryMetadata = mergeTelemetryMetadata(buildTelemetryMetadata(args), options.telemetryMetadata);

  return {
    ...options,
    timeoutMs: coalesceNumber(options.timeoutMs, metadata.timeoutMs),
    intervalMs: coalesceNumber(options.intervalMs, metadata.intervalMs),
    debug: typeof options.debug === "boolean" ? options.debug : Boolean(metadata.debug),
    signal: options.signal ?? args.signal,
    telemetryMetadata,
    sanitizeLogs: options.sanitizeLogs ?? true
  } satisfies TOptions;
}

function buildTelemetryMetadata<TStep extends WorkflowStep>(
  args: ActionExecutionArgs<TStep>
): Record<string, unknown> {
  return {
    runId: args.runId,
    workflowId: args.workflowId,
    stepId: args.step.id,
    stepKind: args.step.kind,
    attempt: args.attempt
  } satisfies Record<string, unknown>;
}

function mergeTelemetryMetadata(
  base: Record<string, unknown>,
  override?: Record<string, unknown>
): Record<string, unknown> {
  if (!override) {
    return base;
  }

  return {
    ...base,
    ...sanitizeForLogging(override)
  } satisfies Record<string, unknown>;
}

function coalesceNumber(value?: number, fallback?: number): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof fallback === "number" && Number.isFinite(fallback)) {
    return fallback;
  }

  return undefined;
}

function toStepError(step: WorkflowStep, error: unknown, options?: WaitOptions): StepError {
  if (error instanceof StepError) {
    return error;
  }

  if (isWaitError(error)) {
    return buildWaitStepError(step, error, options);
  }

  if (error instanceof Error && error.name === "AbortError") {
    return StepError.fromUnknown(step, "cancelled", error);
  }

  return StepError.fromUnknown(step, "unknown", error);
}

function buildWaitStepError(step: WorkflowStep, error: WaitError, options?: WaitOptions): StepError {
  const logicalKey = getStepLogicalKey(step) ?? error.key;
  const reason = error.code === "resolver-miss" ? "resolver-miss" : "timeout";

  return new StepError({
    reason,
    message: buildWaitErrorMessage(error),
    stepKind: step.kind,
    stepId: step.id,
    logicalKey,
    attempts: error.pollCount,
    elapsedMs: error.elapsedMs,
    data: serializeWaitError(error, options)
  }, error);
}

function buildWaitErrorMessage(error: WaitError): string {
  const maskedKey = sanitizeLogicalKey(error.key);
  const keyPart = maskedKey ? ` for '${maskedKey}'` : "";

  switch (error.code) {
    case "resolver-miss":
      return `Wait resolver missed${keyPart} after ${error.pollCount} polls`;
    case "idle-window-exceeded":
      return `Idle window exceeded${keyPart} after ${error.elapsedMs}ms`;
    case "visibility-mismatch":
      return `Visibility mismatch${keyPart} after ${error.elapsedMs}ms`;
    default:
      return `Wait timed out${keyPart} after ${error.elapsedMs}ms`;
  }
}

function serializeWaitError(error: WaitError, options?: WaitOptions): Record<string, unknown> {
  const metadata = buildWaitMetadata(options);
  const sanitizedMetadata = metadata ? sanitizeForLogging(metadata) as Record<string, unknown> : undefined;

  const waitInfo: Record<string, unknown> = {
    code: error.code,
    key: sanitizeLogicalKey(error.key),
    elapsedMs: error.elapsedMs,
    pollCount: error.pollCount,
    staleRecoveries: error.staleRecoveries ?? 0,
    strategyHistory: [...error.strategyHistory],
    finalStrategy: error.strategyHistory[error.strategyHistory.length - 1] ?? null,
    predicateSnapshot: error.predicateSnapshot ? { ...error.predicateSnapshot } : undefined,
    attempts: summarizeAttempts(error.attempts),
    guidance: buildGuidance(error.code),
    metadata: sanitizedMetadata
  } satisfies Record<string, unknown>;

  switch (error.code) {
    case "timeout":
      waitInfo.timeoutMs = error.timeoutMs;
      break;
    case "resolver-miss":
      waitInfo.resolveResult = summarizeResolveResult(error.resolveResult);
      break;
    case "idle-window-exceeded":
      waitInfo.idle = { ...error.idle };
      break;
    case "visibility-mismatch":
      waitInfo.visibility = { ...error.visibility };
      break;
    default:
      break;
  }

  if (error.cause) {
    waitInfo.cause = sanitizeForLogging(error.cause);
  }

  return { wait: waitInfo } satisfies Record<string, unknown>;
}

function summarizeResolveResult(result: ResolveResult): Record<string, unknown> {
  return {
    key: sanitizeLogicalKey(result.key),
    strategy: result.resolvedBy?.type ?? null,
    scopeKey: result.scope?.key ? sanitizeLogicalKey(result.scope.key) : undefined,
    attempts: summarizeAttempts(result.attempts)
  } satisfies Record<string, unknown>;
}

function summarizeAttempts(attempts: ResolveAttempt[]): Array<Record<string, unknown>> {
  return attempts.map((attempt) => ({
    strategy: attempt.strategy.type,
    success: attempt.success,
    elementCount: attempt.elements.length,
    detail: summarizeStrategy(attempt.strategy)
  })) satisfies Array<Record<string, unknown>>;
}

function summarizeStrategy(strategy: SelectorTry): Record<string, unknown> | undefined {
  switch (strategy.type) {
    case "css":
      return { selector: strategy.selector };
    case "xpath":
      return { expression: strategy.expression };
    case "text":
      return {
        text: maskValue(strategy.text),
        exact: Boolean(strategy.exact),
        caseSensitive: Boolean(strategy.caseSensitive)
      } satisfies Record<string, unknown>;
    case "role":
      return {
        role: strategy.role,
        name: strategy.name ? maskValue(strategy.name) : undefined,
        label: strategy.label ? maskValue(strategy.label) : undefined
      } satisfies Record<string, unknown>;
    case "label":
      return {
        label: maskValue(strategy.label),
        caseSensitive: Boolean(strategy.caseSensitive)
      } satisfies Record<string, unknown>;
    case "name":
      return { name: strategy.name } satisfies Record<string, unknown>;
    case "dataAttr":
      return {
        attribute: strategy.attribute,
        value: typeof strategy.value === "string" ? maskValue(strategy.value) : strategy.value
      } satisfies Record<string, unknown>;
    case "testId":
      return {
        attribute: strategy.attribute,
        testId: maskValue(strategy.testId)
      } satisfies Record<string, unknown>;
    default:
      return undefined;
  }
}

function summarizeElement(element: Element | null): Record<string, unknown> | null {
  if (!element) {
    return null;
  }

  const summary: Record<string, unknown> = {
    tagName: typeof element.tagName === "string" ? element.tagName.toLowerCase() : undefined
  } satisfies Record<string, unknown>;

  if ("id" in element && typeof (element as HTMLElement).id === "string" && (element as HTMLElement).id.length > 0) {
    summary.id = (element as HTMLElement).id;
  }

  if ("classList" in element) {
    try {
      const classes = Array.from((element as HTMLElement).classList ?? []).slice(0, 5);
      if (classes.length > 0) {
        summary.classes = classes;
      }
    } catch {
      // ignore classList access issues
    }
  }

  return summary;
}

function buildGuidance(code: WaitError["code"]): string {
  switch (code) {
    case "resolver-miss":
      return "Recorder should capture fallback selectors or update selector map entries.";
    case "idle-window-exceeded":
      return "Increase idleMs or verify mutation sources before retrying.";
    case "visibility-mismatch":
      return "Confirm visibility predicates or adjust to waitHidden/waitVisible.";
    case "timeout":
    default:
      return "Consider extending timeoutMs or reviewing predicate expectations.";
  }
}

export function buildWaitHintsFromStep(source: WaitHintSource): WaitHint | undefined {
  const hints: WaitHint = {};

  if (typeof source.presenceThreshold === "number" && Number.isFinite(source.presenceThreshold)) {
    hints.presenceThreshold = source.presenceThreshold;
  }

  if (typeof source.scrollerKey === "string" && source.scrollerKey.length > 0) {
    hints.scrollerKey = source.scrollerKey;
  }

  if (typeof source.staleRetryCap === "number" && Number.isFinite(source.staleRetryCap)) {
    hints.staleRetryCap = source.staleRetryCap;
  }

  return Object.keys(hints).length > 0 ? hints : undefined;
}

type WaitHintSource = {
  presenceThreshold?: number;
  scrollerKey?: string;
  staleRetryCap?: number;
};

function buildWaitMetadata(options?: WaitOptions): WaitExportMetadata | undefined {
  if (!options) {
    return undefined;
  }

  const timeoutMs = resolveTimeoutMetadata(options);
  const intervalMs = resolveIntervalMetadata(options);
  const presenceThreshold = resolvePresenceThresholdMetadata(options);
  const staleRetryCap = resolveStaleRetryCap(options);
  const scrollerKey = sanitizeLogicalKey(options.scrollerKey ?? options.hints?.scrollerKey ?? undefined);
  const scopeKey = sanitizeLogicalKey(options.scopeKey);

  const metadata: WaitExportMetadata = {
    timeoutMs,
    intervalMs
  };

  if (typeof presenceThreshold === "number") {
    metadata.presenceThreshold = presenceThreshold;
  }

  if (typeof staleRetryCap === "number") {
    metadata.staleRetryCap = staleRetryCap;
  }

  if (typeof scrollerKey === "string" && scrollerKey.length > 0) {
    metadata.scrollerKey = scrollerKey;
  }

  if (typeof scopeKey === "string" && scopeKey.length > 0) {
    metadata.scopeKey = scopeKey;
  }

  metadata.debug = Boolean(options.debug);

  const textMetadata = buildTextMetadata(options);
  if (textMetadata) {
    metadata.text = textMetadata;
  }

  const visibilityMetadata = buildVisibilityMetadata(options);
  if (visibilityMetadata) {
    metadata.visibility = visibilityMetadata;
  }

  const idleMetadata = buildIdleMetadata(options);
  if (idleMetadata) {
    metadata.idle = idleMetadata;
  }

  return metadata;
}

function buildWaitSuccessGuidance(result: WaitResult, metadata?: WaitExportMetadata): string | undefined {
  const suggestions: string[] = [
    "Wait completed successfully; adjust timeoutMs or predicate configuration if playback flake is observed."
  ];

  if (result.staleRecoveries > 0) {
    suggestions.push("Recorder observed stale nodes; capture fallback selectors or increase staleRetryCap.");
  }

  if (!metadata?.presenceThreshold && result.pollCount > 3) {
    suggestions.push("Consider setting presenceThreshold to smooth dynamic rendering or virtualization.");
  }

  if (metadata?.presenceThreshold && metadata.presenceThreshold > 1) {
    suggestions.push(`Presence threshold ${metadata.presenceThreshold} recorded to confirm stability across polls.`);
  }

  if (metadata?.scrollerKey) {
    suggestions.push("Scroller key captured for virtualized list coordination.");
  }

  if (metadata?.idle?.idleMs) {
    suggestions.push("Idle gate active; verify idleMs reflects typical rerender cadence.");
  }

  if (suggestions.length === 0) {
    return undefined;
  }

  return suggestions.join(" ");
}

function resolveTimeoutMetadata(options: WaitOptions): number {
  if (typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs)) {
    return Math.max(0, options.timeoutMs);
  }

  return DEFAULT_WAIT_TIMEOUT_MS;
}

function resolveIntervalMetadata(options: WaitOptions): number {
  if (typeof options.intervalMs === "number" && Number.isFinite(options.intervalMs)) {
    return Math.max(0, options.intervalMs);
  }

  return DEFAULT_WAIT_INTERVAL_MS;
}

function resolvePresenceThresholdMetadata(options: WaitOptions): number | undefined {
  if (typeof options.presenceThreshold === "number" && Number.isFinite(options.presenceThreshold)) {
    return Math.max(1, Math.floor(options.presenceThreshold));
  }

  if (typeof options.hints?.presenceThreshold === "number" && Number.isFinite(options.hints.presenceThreshold)) {
    return Math.max(1, Math.floor(options.hints.presenceThreshold));
  }

  return undefined;
}

function resolveStaleRetryCap(options: WaitOptions): number | undefined {
  if (typeof options.maxResolverRetries === "number" && Number.isFinite(options.maxResolverRetries)) {
    return Math.max(0, Math.floor(options.maxResolverRetries));
  }

  if (typeof options.hints?.staleRetryCap === "number" && Number.isFinite(options.hints.staleRetryCap)) {
    return Math.max(0, Math.floor(options.hints.staleRetryCap));
  }

  return undefined;
}

function buildTextMetadata(options: WaitOptions): WaitExportMetadata["text"] | undefined {
  const hasText = typeof options.text === "string" && options.text.length > 0;
  const hasPattern = options.textPattern instanceof RegExp;

  if (!hasText && !hasPattern && !options.textMode) {
    return undefined;
  }

  return {
    mode: hasPattern ? "regex" : (options.textMode ?? (hasText ? "exact" : undefined)),
    hasText,
    hasPattern,
    length: hasText ? options.text!.length : undefined
  };
}

function buildVisibilityMetadata(options: WaitOptions): WaitExportMetadata["visibility"] | undefined {
  if (!options.visibility) {
    return undefined;
  }

  const visibility = options.visibility;

  return {
    target: visibility.target,
    requireDisplayed: visibility.requireDisplayed,
    requireInViewport: visibility.requireInViewport,
    minOpacity: visibility.minOpacity,
    minIntersectionRatio: visibility.minIntersectionRatio,
    minBoundingBoxArea: visibility.minBoundingBoxArea
  };
}

function buildIdleMetadata(options: WaitOptions): WaitExportMetadata["idle"] | undefined {
  if (!options.idle) {
    return undefined;
  }

  const idle = options.idle;

  return {
    idleMs: idle.idleMs,
    maxWindowMs: idle.maxWindowMs,
    heartbeatMs: idle.heartbeatMs,
    captureStatistics: idle.captureStatistics
  };
}

type WaitExportMetadata = {
  timeoutMs: number;
  intervalMs: number;
  presenceThreshold?: number;
  staleRetryCap?: number;
  scrollerKey?: string;
  scopeKey?: string;
  debug?: boolean;
  text?: {
    mode?: string;
    hasText?: boolean;
    hasPattern?: boolean;
    length?: number;
  };
  visibility?: {
    target: string;
    requireDisplayed?: boolean;
    requireInViewport?: boolean;
    minOpacity?: number;
    minIntersectionRatio?: number;
    minBoundingBoxArea?: number;
  };
  idle?: {
    idleMs: number;
    maxWindowMs?: number;
    heartbeatMs?: number;
    captureStatistics?: boolean;
  };
};

function mergeLogPayload(
  base: Record<string, unknown>,
  data?: Record<string, unknown>
): Record<string, unknown> {
  if (!data) {
    return { ...base };
  }

  const payload = { ...base } as Record<string, unknown>;
  const sanitized = sanitizeForLogging(data);

  Object.entries(sanitized).forEach(([key, value]) => {
    if (key === "key") {
      payload.logicalKey = sanitizeLogicalKey(value as string | undefined);
      return;
    }

    payload[key] = value;
  });

  return payload;
}

function buildLogBase<TStep extends WorkflowStep>(args: ActionExecutionArgs<TStep>): Record<string, unknown> {
  return {
    runId: args.runId,
    workflowId: args.workflowId,
    stepId: args.step.id,
    stepKind: args.step.kind,
    logicalKey: sanitizeLogicalKey(getStepLogicalKey(args.step)),
    attempt: args.attempt
  } satisfies Record<string, unknown>;
}

function getStepLogicalKey(step: WorkflowStep): string | undefined {
  const candidate = (step as { key?: unknown }).key;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

function cloneResolveResult(result: ResolveResult): ResolveResult {
  return {
    ...result,
    attempts: result.attempts.map((attempt) => ({
      strategy: attempt.strategy,
      success: attempt.success,
      elements: [...attempt.elements]
    })),
    scope: result.scope ? { ...result.scope } : undefined
  } satisfies ResolveResult;
}

function applyScopeFilter(result: ResolveResult, scope?: QueryRoot | null): ResolveResult {
  if (!scope) {
    return result;
  }

  if (result.attempts.length === 0) {
    return {
      ...result,
      scope: result.scope ?? { root: scope }
    } satisfies ResolveResult;
  }

  const filteredAttempts = result.attempts.map((attempt) => {
    const elements = attempt.elements.filter((element) => isElementWithinScope(element, scope));
    return {
      strategy: attempt.strategy,
      success: elements.length > 0,
      elements
    } satisfies ResolveAttempt;
  });

  const successAttempt = filteredAttempts.find((attempt) => attempt.success) ?? null;
  const nextElement = successAttempt ? successAttempt.elements[0] ?? null : null;

  return {
    ...result,
    attempts: filteredAttempts,
    element: nextElement,
    resolvedBy: successAttempt ? successAttempt.strategy : result.resolvedBy,
    scope: result.scope ?? { root: scope }
  } satisfies ResolveResult;
}

function isElementWithinScope(element: Element, scope: QueryRoot | null): boolean {
  if (!scope) {
    return true;
  }

  if (typeof Document !== "undefined" && scope instanceof Document) {
    return element.ownerDocument === scope;
  }

  if (typeof Element !== "undefined" && scope instanceof Element) {
    return scope === element || scope.contains(element);
  }

  if (typeof ShadowRoot !== "undefined" && scope instanceof ShadowRoot) {
    try {
      return element.getRootNode() === scope;
    } catch {
      return false;
    }
  }

  if (typeof DocumentFragment !== "undefined" && scope instanceof DocumentFragment) {
    try {
      return element.getRootNode() === scope;
    } catch {
      return false;
    }
  }

  return true;
}

function isWaitError(value: unknown): value is WaitError {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as { code?: unknown };
  return typeof candidate.code === "string" && (
    candidate.code === "timeout" ||
    candidate.code === "resolver-miss" ||
    candidate.code === "idle-window-exceeded" ||
    candidate.code === "visibility-mismatch"
  );
}

function buildAbortError(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error) {
    return signal.reason;
  }

  if (typeof DOMException !== "undefined") {
    return new DOMException("Operation aborted", "AbortError");
  }

  const error = new Error("Operation aborted");
  error.name = "AbortError";
  return error;
}
