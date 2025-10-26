import {
  createWaitHelpers,
  wait as delay,
  type WaitError,
  type WaitForOptions,
  type WaitHelpers,
  type WaitHelpersDependencies,
  type WaitLogger,
  type WaitOptions,
  type WaitResult,
  type WaitTelemetry,
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
import { maskValue, SENSITIVE_KEY_PATTERN } from "./shared";
import type { WorkflowStep } from "../types";
import { StepError } from "../engine/errors";

export type WaitActionKind = "waitFor" | "waitText" | "waitVisible" | "waitHidden" | "waitForIdle";

export async function runWait<TStep extends WorkflowStep, TOptions extends WaitOptions>(
  kind: WaitActionKind,
  args: ActionExecutionArgs<TStep>,
  runtime: ActionRuntimeOptions,
  options: TOptions
): Promise<WaitResult> {
  const helpers = createWaitHelpersForStep(args, runtime);
  const waitOptions = buildWaitOptions(args, options);

  try {
    switch (kind) {
      case "waitFor":
        return await helpers.waitFor(waitOptions as WaitForOptions);
      case "waitText":
        return await helpers.waitText(waitOptions as WaitTextOptions);
      case "waitVisible":
        return await helpers.waitVisible(waitOptions as WaitVisibilityOptions);
      case "waitHidden":
        return await helpers.waitHidden(waitOptions as WaitVisibilityOptions);
      case "waitForIdle":
        return await helpers.waitForIdle(waitOptions as WaitIdleOptions);
      default:
        throw new StepError({
          reason: "unknown",
          message: `Unsupported wait kind '${String(kind)}'`,
          stepKind: args.step.kind,
          stepId: args.step.id
        });
    }
  } catch (error) {
    throw toStepError(args.step, error);
  }
}

export function serializeWaitResult(result: WaitResult): Record<string, unknown> {
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
    finishedAt: result.finishedAt
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

  return {
    onStart(event) {
      logger.info?.("[DGX] wait:start", mergeLogPayload(base, buildTelemetryPayload(event)));
    },
    onAttempt(event) {
      if (!debugEnabled) {
        return;
      }
      logger.debug?.("[DGX] wait:attempt", mergeLogPayload(base, buildTelemetryPayload(event)));
    },
    onHeartbeat(event) {
      logger.info?.("[DGX] wait:heartbeat", mergeLogPayload(base, buildTelemetryPayload(event)));
    },
    onSuccess(event) {
      logger.info?.("[DGX] wait:success", mergeLogPayload(base, {
        key: sanitizeLogicalKey(event.result.key),
        result: serializeWaitResult(event.result)
      }));
    },
    onFailure(event) {
      logger.warn?.("[DGX] wait:failure", mergeLogPayload(base, serializeWaitError(event.error)));
    }
  } satisfies WaitTelemetry;
}

function buildTelemetryPayload(event: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  if ("key" in event) {
    payload.key = sanitizeLogicalKey(event.key as string | undefined);
  }

  if ("metadata" in event && event.metadata) {
    payload.metadata = sanitizeForLogging(event.metadata);
  }

  if ("pollCount" in event) {
    payload.pollCount = event.pollCount;
  }

  if ("elapsedMs" in event) {
    payload.elapsedMs = event.elapsedMs;
  }

  if ("remainingMs" in event) {
    payload.remainingMs = event.remainingMs;
  }

  if ("strategyHistory" in event) {
    payload.strategyHistory = Array.isArray(event.strategyHistory)
      ? [...event.strategyHistory]
      : event.strategyHistory;
  }

  if ("predicateSnapshot" in event && event.predicateSnapshot) {
    payload.predicateSnapshot = sanitizeForLogging(event.predicateSnapshot);
  }

  if ("staleRecoveries" in event) {
    payload.staleRecoveries = event.staleRecoveries;
  }

  if ("timeoutMs" in event) {
    payload.timeoutMs = event.timeoutMs;
  }

  if ("pollCount" in event && "success" in event) {
    payload.success = event.success;
  }

  return payload;
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

function toStepError(step: WorkflowStep, error: unknown): StepError {
  if (error instanceof StepError) {
    return error;
  }

  if (isWaitError(error)) {
    return buildWaitStepError(step, error);
  }

  if (error instanceof Error && error.name === "AbortError") {
    return StepError.fromUnknown(step, "cancelled", error);
  }

  return StepError.fromUnknown(step, "unknown", error);
}

function buildWaitStepError(step: WorkflowStep, error: WaitError): StepError {
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
    data: serializeWaitError(error)
  }, error);
}

function buildWaitErrorMessage(error: WaitError): string {
  const keyPart = error.key ? ` for '${error.key}'` : "";

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

function serializeWaitError(error: WaitError): Record<string, unknown> {
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
    guidance: buildGuidance(error.code)
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

function sanitizeForLogging(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeForLogging(entry));
  }

  if (isDomElement(value)) {
    return summarizeElement(value);
  }

  if (value && typeof value === "object") {
    const entries = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};

    Object.entries(entries).forEach(([key, entry]) => {
      if (key === "element" || key === "target") {
        output[key] = summarizeElement(isDomElement(entry) ? (entry as Element) : null);
        return;
      }

      if (SENSITIVE_KEY_PATTERN.test(key)) {
        output[key] = maskValue(entry);
        return;
      }

      output[key] = sanitizeForLogging(entry);
    });

    return output;
  }

  return value;
}

function getStepLogicalKey(step: WorkflowStep): string | undefined {
  const candidate = (step as { key?: unknown }).key;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

function sanitizeLogicalKey(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  if (SENSITIVE_KEY_PATTERN.test(value)) {
    return maskValue(value) as string;
  }

  return value;
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

function isDomElement(value: unknown): value is Element {
  return typeof Element !== "undefined" && value instanceof Element;
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
