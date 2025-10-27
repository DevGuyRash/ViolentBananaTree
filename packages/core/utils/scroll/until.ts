import type {
  ScrollContainerDetectionOptions,
  ScrollContainerDetector,
  ScrollContainerResolution
} from "./container";

const DEFAULT_STEP_PX = 320;
const DEFAULT_MAX_ATTEMPTS = 40;
const DEFAULT_DELAY_MS = 200;
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MIN_DELTA_PX = 2;

const MAX_STEP_PX = 500;
const MAX_DELAY_MS = 1000;
const MIN_STEP_PX = 1;
const MIN_DELAY_MS = 0;
const NO_CHANGE_CONSECUTIVE_LIMIT = 2;

export type ScrollUntilStopCondition =
  | { kind: "end" }
  | { kind: "element"; key?: string; css?: string; xpath?: string }
  | { kind: "list-growth"; parentKey?: string; itemCss?: string; minDelta?: number }
  | { kind: "predicate"; id?: string };

export type ScrollUntilStatus =
  | "success"
  | "timeout"
  | "no_change"
  | "predicate_error"
  | "cancelled"
  | "container_unavailable";

export interface ScrollVector {
  x: number;
  y: number;
}

export interface ScrollContainerSnapshot {
  scrollTop: number;
  scrollLeft: number;
  maxScrollTop: number;
  maxScrollLeft: number;
  scrollHeight: number;
  scrollWidth: number;
  clientHeight: number;
  clientWidth: number;
}

export interface ScrollUntilPredicateContext {
  container: Element;
  attempt: number;
  elapsedMs: number;
  startedAt: number;
  delta: ScrollVector;
  cumulativeDelta: ScrollVector;
  containerSnapshot: ScrollContainerSnapshot;
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface ScrollUntilPredicateResult {
  satisfied: boolean;
  reason?: string;
  snapshot?: Record<string, unknown>;
  domStable?: boolean;
}

export interface ScrollUntilPredicateRegistry {
  evaluate(
    condition: ScrollUntilStopCondition,
    context: ScrollUntilPredicateContext
  ): Promise<ScrollUntilPredicateResult> | ScrollUntilPredicateResult;
}

export interface ScrollUntilTelemetryStartEvent {
  runId: string;
  mode: ScrollUntilStopCondition["kind"];
  startedAt: number;
  config: ScrollUntilResolvedConfig;
  metadata?: Record<string, unknown>;
  containerStrategy?: string | null;
}

export interface ScrollUntilTelemetryAttemptEvent {
  runId: string;
  attempt: number;
  elapsedMs: number;
  delta: ScrollVector;
  cumulativeDelta: ScrollVector;
  status: "success" | "continue" | "no_change" | "timeout" | "cancelled" | "predicate_error";
  snapshot?: Record<string, unknown>;
  domStable?: boolean;
  reason?: string;
}

export interface ScrollUntilTelemetryCompleteEvent {
  runId: string;
  result: ScrollUntilResult;
}

export interface ScrollUntilTelemetry {
  onStart?(event: ScrollUntilTelemetryStartEvent): void;
  onAttempt?(event: ScrollUntilTelemetryAttemptEvent): void;
  onComplete?(event: ScrollUntilTelemetryCompleteEvent): void;
}

export interface ScrollUntilDefaults {
  stepPx?: number;
  maxAttempts?: number;
  delayMs?: number;
  timeoutMs?: number;
  minDeltaPx?: number;
}

export interface ScrollUntilResolvedConfig {
  stepPx: number;
  maxAttempts: number;
  delayMs: number;
  timeoutMs: number;
  minDeltaPx: number;
}

export interface ScrollUntilRunOptions {
  until: ScrollUntilStopCondition;
  anchor?: Element | null | undefined;
  container?: Element | null | undefined;
  containerKey?: string;
  containerDetection?: ScrollContainerDetectionOptions;
  stepPx?: number;
  maxAttempts?: number;
  delayMs?: number;
  timeoutMs?: number;
  minDeltaPx?: number;
  telemetry?: ScrollUntilTelemetry | null;
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface ScrollUntilDependencies {
  predicateRegistry: ScrollUntilPredicateRegistry;
  containerDetector?: ScrollContainerDetector | null;
  resolveContainerKey?: (key: string) => Element | null | undefined;
  defaults?: ScrollUntilDefaults;
  clock?: { now(): number };
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  logger?: {
    debug?(message: string, data?: Record<string, unknown>): void;
    info?(message: string, data?: Record<string, unknown>): void;
    warn?(message: string, data?: Record<string, unknown>): void;
    error?(message: string, data?: Record<string, unknown>): void;
  } | null;
  runIdFactory?: () => string;
}

export interface ScrollUntilResult {
  status: ScrollUntilStatus;
  attempts: number;
  startedAt: number;
  finishedAt: number;
  elapsedMs: number;
  lastDelta: ScrollVector;
  cumulativeDelta: ScrollVector;
  config: ScrollUntilResolvedConfig;
  reason?: string;
  container: Element | null;
  runId: string;
  predicateSnapshot?: Record<string, unknown>;
  domStable?: boolean;
  consecutiveNoChange: number;
  metadata?: Record<string, unknown>;
}

export interface ScrollUntilRunner {
  run(options: ScrollUntilRunOptions): Promise<ScrollUntilResult>;
}

interface NormalizedOptions {
  config: ScrollUntilResolvedConfig;
  telemetry: ScrollUntilTelemetry | null;
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
}

interface ContainerResolutionOutcome {
  element: Element | null;
  strategy: string | null;
  resolution?: ScrollContainerResolution | null;
}

export function createScrollUntilRunner(dependencies: ScrollUntilDependencies): ScrollUntilRunner {
  const predicateRegistry = dependencies.predicateRegistry;
  if (!predicateRegistry) {
    throw new Error("createScrollUntilRunner requires a predicateRegistry dependency");
  }

  const containerDetector = dependencies.containerDetector ?? null;
  const resolveContainerKey = dependencies.resolveContainerKey;
  const clock = dependencies.clock ?? { now: () => Date.now() };
  const sleep = dependencies.sleep ?? defaultSleep;
  const logger = dependencies.logger ?? null;
  const defaults = resolveDefaults(dependencies.defaults);
  const runIdFactory = dependencies.runIdFactory ?? defaultRunIdFactory;

  const runner: ScrollUntilRunner = {
    async run(options) {
      const normalized = normalizeOptions(options, defaults);
      const config = normalized.config;
      const startedAt = clock.now();
      const deadline = startedAt + config.timeoutMs;
      const runId = runIdFactory();
      const mode = options.until.kind;

      const containerOutcome = resolveContainer(options, {
        containerDetector,
        resolveContainerKey
      });

      const container = containerOutcome.element;

      if (!isElement(container)) {
        const result: ScrollUntilResult = {
          status: "container_unavailable",
          attempts: 0,
          startedAt,
          finishedAt: clock.now(),
          elapsedMs: 0,
          lastDelta: { x: 0, y: 0 },
          cumulativeDelta: { x: 0, y: 0 },
          config,
          reason: "container-unavailable",
          container: null,
          runId,
          consecutiveNoChange: 0,
          metadata: normalized.metadata
        } satisfies ScrollUntilResult;

        emitTelemetryComplete(normalized.telemetry, {
          runId,
          result
        });

        return result;
      }

      emitTelemetryStart(normalized.telemetry, {
        runId,
        mode,
        startedAt,
        config,
        metadata: normalized.metadata,
        containerStrategy: containerOutcome.strategy
      });

      const cumulativeDelta: ScrollVector = { x: 0, y: 0 };
      let lastDelta: ScrollVector = { x: 0, y: 0 };
      let predicateSnapshot: Record<string, unknown> | undefined;
      let domStable: boolean | undefined;
      let attempts = 0;
      let consecutiveNoChange = 0;

      const initialSnapshot = captureSnapshot(container);

      const initialEvaluation = await evaluatePredicate(predicateRegistry, options.until, {
        container,
        attempt: 0,
        elapsedMs: 0,
        startedAt,
        delta: { x: 0, y: 0 },
        cumulativeDelta,
        containerSnapshot: initialSnapshot,
        metadata: normalized.metadata,
        signal: normalized.signal
      });

      if (isPredicateError(initialEvaluation)) {
        const finishedAt = clock.now();
        const result: ScrollUntilResult = {
          status: "predicate_error",
          attempts,
          startedAt,
          finishedAt,
          elapsedMs: finishedAt - startedAt,
          lastDelta,
          cumulativeDelta,
          config,
          reason: initialEvaluation.reason,
          container,
          runId,
          predicateSnapshot,
          domStable,
          consecutiveNoChange,
          metadata: normalized.metadata
        } satisfies ScrollUntilResult;

        emitTelemetryAttempt(normalized.telemetry, {
          runId,
          attempt: attempts,
          elapsedMs: 0,
          delta: lastDelta,
          cumulativeDelta,
          status: "predicate_error",
          snapshot: predicateSnapshot,
          domStable,
          reason: initialEvaluation.reason
        });

        emitTelemetryComplete(normalized.telemetry, {
          runId,
          result
        });

        return result;
      }

      predicateSnapshot = initialEvaluation.snapshot ?? predicateSnapshot;
      domStable = initialEvaluation.domStable ?? domStable;

      if (initialEvaluation.satisfied) {
        const finishedAt = clock.now();
        const result: ScrollUntilResult = {
          status: "success",
          attempts,
          startedAt,
          finishedAt,
          elapsedMs: finishedAt - startedAt,
          lastDelta,
          cumulativeDelta,
          config,
          reason: initialEvaluation.reason ?? "predicate-satisfied",
          container,
          runId,
          predicateSnapshot,
          domStable,
          consecutiveNoChange,
          metadata: normalized.metadata
        } satisfies ScrollUntilResult;

        emitTelemetryAttempt(normalized.telemetry, {
          runId,
          attempt: attempts,
          elapsedMs: 0,
          delta: lastDelta,
          cumulativeDelta,
          status: "success",
          snapshot: predicateSnapshot,
          domStable,
          reason: result.reason
        });

        emitTelemetryComplete(normalized.telemetry, {
          runId,
          result
        });

        return result;
      }

      let status: ScrollUntilStatus | null = null;
      let reason: string | undefined;

      while (attempts < config.maxAttempts) {
        if (normalized.signal?.aborted) {
          status = "cancelled";
          reason = formatAbortReason(normalized.signal.reason);
          break;
        }

        const now = clock.now();
        if (now >= deadline && attempts > 0) {
          status = "timeout";
          reason = "timeout-exceeded";
          break;
        }

        const beforeSnapshot = captureSnapshot(container);

        const targetScrollTop = clamp(beforeSnapshot.scrollTop + config.stepPx, 0, beforeSnapshot.maxScrollTop);
        const targetScrollLeft = clamp(beforeSnapshot.scrollLeft, 0, beforeSnapshot.maxScrollLeft);

        setScrollPosition(container, targetScrollLeft, targetScrollTop);

        const afterSnapshot = captureSnapshot(container);

        lastDelta = {
          x: afterSnapshot.scrollLeft - beforeSnapshot.scrollLeft,
          y: afterSnapshot.scrollTop - beforeSnapshot.scrollTop
        } satisfies ScrollVector;

        cumulativeDelta.x += lastDelta.x;
        cumulativeDelta.y += lastDelta.y;

        attempts += 1;

        if (config.delayMs > 0) {
          try {
            await sleep(config.delayMs, normalized.signal);
          } catch (error) {
            status = "cancelled";
            reason = formatAbortReason(error);
            break;
          }
        }

        const elapsedMs = Math.max(0, clock.now() - startedAt);

        const evaluation = await evaluatePredicate(predicateRegistry, options.until, {
          container,
          attempt: attempts,
          elapsedMs,
          startedAt,
          delta: lastDelta,
          cumulativeDelta,
          containerSnapshot: afterSnapshot,
          metadata: normalized.metadata,
          signal: normalized.signal
        });

        if (isPredicateError(evaluation)) {
          status = "predicate_error";
          reason = evaluation.reason;
          emitTelemetryAttempt(normalized.telemetry, {
            runId,
            attempt: attempts,
            elapsedMs,
            delta: lastDelta,
            cumulativeDelta,
            status,
            snapshot: predicateSnapshot,
            domStable,
            reason
          });
          break;
        }

        predicateSnapshot = evaluation.snapshot ?? predicateSnapshot;
        domStable = evaluation.domStable ?? domStable;

        if (evaluation.satisfied) {
          status = "success";
          reason = evaluation.reason ?? "predicate-satisfied";
          emitTelemetryAttempt(normalized.telemetry, {
            runId,
            attempt: attempts,
            elapsedMs,
            delta: lastDelta,
            cumulativeDelta,
            status: "success",
            snapshot: predicateSnapshot,
            domStable,
            reason
          });
          break;
        }

        const deltaMagnitudeOk =
          Math.abs(lastDelta.x) >= config.minDeltaPx || Math.abs(lastDelta.y) >= config.minDeltaPx;

        if (!deltaMagnitudeOk) {
          consecutiveNoChange += 1;
          if (consecutiveNoChange >= NO_CHANGE_CONSECUTIVE_LIMIT) {
            status = "no_change";
            reason = evaluation.reason ?? "no-change-detected";
          }
        } else {
          consecutiveNoChange = 0;
        }

        emitTelemetryAttempt(normalized.telemetry, {
          runId,
          attempt: attempts,
          elapsedMs,
          delta: lastDelta,
          cumulativeDelta,
          status: status ?? "continue",
          snapshot: predicateSnapshot,
          domStable,
          reason
        });

        if (status) {
          break;
        }

        const postLoopNow = clock.now();
        if (postLoopNow >= deadline) {
          status = "timeout";
          reason = "timeout-exceeded";
          break;
        }
      }

      if (!status) {
        status = "timeout";
        reason = "max-attempts-exhausted";
      }

      const finishedAt = clock.now();
      const result: ScrollUntilResult = {
        status,
        attempts,
        startedAt,
        finishedAt,
        elapsedMs: Math.max(0, finishedAt - startedAt),
        lastDelta,
        cumulativeDelta,
        config,
        reason,
        container,
        runId,
        predicateSnapshot,
        domStable,
        consecutiveNoChange,
        metadata: normalized.metadata
      } satisfies ScrollUntilResult;

      emitTelemetryComplete(normalized.telemetry, {
        runId,
        result
      });

      logger?.debug?.("scroll-until:result", {
        status: result.status,
        attempts: result.attempts,
        reason: result.reason,
        elapsedMs: result.elapsedMs,
        consecutiveNoChange: result.consecutiveNoChange
      });

      return result;
    }
  } satisfies ScrollUntilRunner;

  return runner;
}

function normalizeOptions(options: ScrollUntilRunOptions, defaults: ScrollUntilResolvedConfig): NormalizedOptions {
  const rawStep = options.stepPx;
  const rawDelay = options.delayMs;
  const rawTimeout = options.timeoutMs;
  const rawAttempts = options.maxAttempts;
  const rawMinDelta = options.minDeltaPx;

  const stepPx = clamp(Math.abs(Number.isFinite(rawStep ?? NaN) ? (rawStep as number) : defaults.stepPx), MIN_STEP_PX, MAX_STEP_PX);
  const delayMs = clamp(Number.isFinite(rawDelay ?? NaN) ? (rawDelay as number) : defaults.delayMs, MIN_DELAY_MS, MAX_DELAY_MS);
  const timeoutMs = Math.max(1, Number.isFinite(rawTimeout ?? NaN) ? Math.floor(rawTimeout as number) : defaults.timeoutMs);
  const maxAttempts = Math.max(1, Number.isFinite(rawAttempts ?? NaN) ? Math.floor(rawAttempts as number) : defaults.maxAttempts);
  const minDeltaPx = Math.max(0, Number.isFinite(rawMinDelta ?? NaN) ? (rawMinDelta as number) : defaults.minDeltaPx);

  const config: ScrollUntilResolvedConfig = {
    stepPx,
    delayMs,
    timeoutMs,
    maxAttempts,
    minDeltaPx
  } satisfies ScrollUntilResolvedConfig;

  return {
    config,
    telemetry: options.telemetry ?? null,
    metadata: options.metadata,
    signal: options.signal
  } satisfies NormalizedOptions;
}

function resolveDefaults(overrides?: ScrollUntilDefaults): ScrollUntilResolvedConfig {
  return {
    stepPx: clamp(Math.abs(overrides?.stepPx ?? DEFAULT_STEP_PX), MIN_STEP_PX, MAX_STEP_PX),
    maxAttempts: Math.max(1, overrides?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS),
    delayMs: clamp(overrides?.delayMs ?? DEFAULT_DELAY_MS, MIN_DELAY_MS, MAX_DELAY_MS),
    timeoutMs: Math.max(1, overrides?.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    minDeltaPx: Math.max(0, overrides?.minDeltaPx ?? DEFAULT_MIN_DELTA_PX)
  } satisfies ScrollUntilResolvedConfig;
}

function resolveContainer(
  options: ScrollUntilRunOptions,
  dependencies: {
    containerDetector: ScrollContainerDetector | null;
    resolveContainerKey?: (key: string) => Element | null | undefined;
  }
): ContainerResolutionOutcome {
  if (isElement(options.container)) {
    return { element: options.container, strategy: "explicit", resolution: null } satisfies ContainerResolutionOutcome;
  }

  if (options.containerKey && dependencies.resolveContainerKey) {
    try {
      const resolved = dependencies.resolveContainerKey(options.containerKey);
      if (isElement(resolved)) {
        return { element: resolved, strategy: "container-key", resolution: null } satisfies ContainerResolutionOutcome;
      }
    } catch {
      // ignore key resolution errors
    }
  }

  if (dependencies.containerDetector) {
    try {
      const resolution = dependencies.containerDetector.detect(options.anchor ?? null, options.containerDetection);
      if (resolution?.element && isElement(resolution.element)) {
        return { element: resolution.element, strategy: resolution.strategy?.kind ?? "detected", resolution } satisfies ContainerResolutionOutcome;
      }
    } catch {
      // ignore detector errors and fall through to document fallback
    }
  }

  const documentFallback = resolveDocumentContainer();
  if (documentFallback) {
    return { element: documentFallback, strategy: "document", resolution: null } satisfies ContainerResolutionOutcome;
  }

  return { element: null, strategy: null, resolution: null } satisfies ContainerResolutionOutcome;
}

function resolveDocumentContainer(): Element | null {
  if (typeof globalThis.document === "undefined" || !globalThis.document) {
    return null;
  }

  const doc = globalThis.document;

  const scrollingElement = doc.scrollingElement;
  if (isElement(scrollingElement)) {
    return scrollingElement;
  }

  if (isElement(doc.documentElement)) {
    return doc.documentElement;
  }

  if (isElement(doc.body)) {
    return doc.body;
  }

  return null;
}

function captureSnapshot(container: Element): ScrollContainerSnapshot {
  const cast = container as unknown as Partial<HTMLElement>;

  const scrollTop = toNumber(cast.scrollTop);
  const scrollLeft = toNumber(cast.scrollLeft);
  const scrollHeight = Math.max(toNumber(cast.scrollHeight), 0);
  const scrollWidth = Math.max(toNumber(cast.scrollWidth), 0);
  const clientHeight = Math.max(toNumber(cast.clientHeight), 0) || inferClientSize(container, "height");
  const clientWidth = Math.max(toNumber(cast.clientWidth), 0) || inferClientSize(container, "width");

  return {
    scrollTop,
    scrollLeft,
    scrollHeight,
    scrollWidth,
    clientHeight,
    clientWidth,
    maxScrollTop: Math.max(0, scrollHeight - clientHeight),
    maxScrollLeft: Math.max(0, scrollWidth - clientWidth)
  } satisfies ScrollContainerSnapshot;
}

async function evaluatePredicate(
  registry: ScrollUntilPredicateRegistry,
  condition: ScrollUntilStopCondition,
  context: ScrollUntilPredicateContext
): Promise<ScrollUntilPredicateResult | { kind: "error"; reason: string }> {
  try {
    const result = await registry.evaluate(condition, context);
    if (!result || typeof result !== "object") {
      return { satisfied: false } satisfies ScrollUntilPredicateResult;
    }
    return result;
  } catch (error) {
    return {
      kind: "error",
      reason: formatErrorMessage(error)
    } as const;
  }
}

function setScrollPosition(container: Element, left: number, top: number): void {
  const cast = container as unknown as Partial<HTMLElement> & { scroll?(x: number, y: number): void };

  if (typeof cast.scroll === "function") {
    try {
      cast.scroll(left, top);
      return;
    } catch {
      // fall through
    }
  }

  if (typeof cast.scrollTo === "function") {
    try {
      cast.scrollTo(left, top);
      return;
    } catch {
      // fall through
    }
  }

  if (typeof cast.scrollLeft === "number") {
    cast.scrollLeft = left;
  }

  if (typeof cast.scrollTop === "number") {
    cast.scrollTop = top;
  }
}

function inferClientSize(element: Element, dimension: "height" | "width"): number {
  const rect = getRect(element);
  return dimension === "height" ? rect.height : rect.width;
}

function getRect(element: Element): DOMRect {
  if (typeof (element as { getBoundingClientRect?: () => DOMRect | DOMRectReadOnly }).getBoundingClientRect === "function") {
    const rect = (element as { getBoundingClientRect?: () => DOMRect | DOMRectReadOnly }).getBoundingClientRect!();
    return normalizeRect(rect);
  }

  return normalizeRect({
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0
  } as DOMRect);
}

function normalizeRect(rect: DOMRect | DOMRectReadOnly): DOMRect {
  if (typeof DOMRect !== "undefined" && rect instanceof DOMRect) {
    return rect;
  }

  const { top, left, right, bottom, width, height } = rect;

  const domRect = {
    top,
    left,
    right,
    bottom,
    width,
    height,
    x: left,
    y: top,
    toJSON() {
      return { top, left, right, bottom, width, height };
    }
  } as DOMRect;

  return domRect;
}

function emitTelemetryStart(telemetry: ScrollUntilTelemetry | null, event: ScrollUntilTelemetryStartEvent): void {
  try {
    telemetry?.onStart?.(event);
  } catch {
    // ignore telemetry failures
  }
}

function emitTelemetryAttempt(telemetry: ScrollUntilTelemetry | null, event: ScrollUntilTelemetryAttemptEvent): void {
  try {
    telemetry?.onAttempt?.(event);
  } catch {
    // ignore telemetry failures
  }
}

function emitTelemetryComplete(telemetry: ScrollUntilTelemetry | null, event: ScrollUntilTelemetryCompleteEvent): void {
  try {
    telemetry?.onComplete?.(event);
  } catch {
    // ignore telemetry failures
  }
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    if (signal?.aborted) {
      return Promise.reject(createAbortError(signal.reason));
    }
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError(signal.reason));
      return;
    }

    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const cleanup = () => {
      clearTimeout(timer);
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    };

    const onAbort = () => {
      cleanup();
      reject(createAbortError(signal?.reason));
    };

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

function createAbortError(reason: unknown): DOMException {
  if (reason instanceof DOMException) {
    return reason;
  }
  return new DOMException("Operation aborted", "AbortError");
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return 0;
}

function formatErrorMessage(error: unknown): string {
  if (!error) {
    return "predicate-error";
  }

  if (error instanceof Error) {
    return error.message || error.name || "predicate-error";
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "predicate-error";
  }
}

function formatAbortReason(reason: unknown): string {
  if (reason instanceof Error) {
    return reason.message || "aborted";
  }
  if (typeof reason === "string") {
    return reason || "aborted";
  }
  return "aborted";
}

function isPredicateError(
  result: ScrollUntilPredicateResult | { kind: "error"; reason: string }
): result is { kind: "error"; reason: string } {
  return typeof result === "object" && result !== null && "kind" in result && (result as { kind?: string }).kind === "error";
}

function defaultRunIdFactory(): string {
  try {
    if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
  } catch {
    // ignore
  }

  const randomPart = Math.random().toString(36).slice(2, 10);
  const timePart = Date.now().toString(36);
  return `scroll-${randomPart}-${timePart}`;
}

function isElement(value: unknown): value is Element {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (typeof Element !== "undefined") {
    return value instanceof Element;
  }

  return (value as { nodeType?: number }).nodeType === 1;
}
