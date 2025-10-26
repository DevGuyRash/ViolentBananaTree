import type {
  WaitLogger,
  WaitTelemetry,
  WaitTelemetryAttemptEvent,
  WaitTelemetryFailureEvent,
  WaitTelemetryHeartbeatEvent,
  WaitTelemetryStartEvent,
  WaitTelemetrySuccessEvent
} from "./scheduler";
import type { WaitError } from "./types";

export type WaitTelemetryEventKind = "start" | "attempt" | "heartbeat" | "success" | "failure";

export type WaitTelemetryLogLevel = "debug" | "info" | "warn" | "error";

export interface WaitTelemetryEventEnvelope {
  kind: WaitTelemetryEventKind;
  level: WaitTelemetryLogLevel;
  event: string;
  payload: Record<string, unknown>;
}

export type WaitTelemetryNotifier = (event: WaitTelemetryEventEnvelope) => void;

export interface WaitTelemetrySerializerOptions {
  start?: (event: WaitTelemetryStartEvent) => Record<string, unknown> | undefined;
  attempt?: (event: WaitTelemetryAttemptEvent) => Record<string, unknown> | undefined;
  heartbeat?: (event: WaitTelemetryHeartbeatEvent) => Record<string, unknown> | undefined;
  success?: (event: WaitTelemetrySuccessEvent) => Record<string, unknown> | undefined;
  failure?: (event: WaitTelemetryFailureEvent) => Record<string, unknown> | undefined;
}

export interface WaitTelemetryAdapterOptions {
  logger?: WaitLogger;
  basePayload?: Record<string, unknown>;
  debug?: boolean;
  notify?: WaitTelemetryNotifier;
  serializers?: WaitTelemetrySerializerOptions;
  transformPayload?: (
    payload: Record<string, unknown>,
    kind: WaitTelemetryEventKind
  ) => Record<string, unknown>;
  buildFailureNarrative?: (error: WaitError) => string;
  eventPrefix?: string;
}

export const DEFAULT_WAIT_EVENT_PREFIX = "[DGX] wait";

const DEFAULT_GUIDANCE: Record<WaitError["code"] | "default", string> = {
  "resolver-miss": "Recorder should capture fallback selectors or update selector map entries.",
  "idle-window-exceeded": "Increase idleMs or verify mutation sources before retrying.",
  "visibility-mismatch": "Confirm visibility predicates or adjust to waitHidden/waitVisible.",
  timeout: "Consider extending timeoutMs or reviewing predicate expectations.",
  default: "Review wait configuration and predicate expectations before retrying."
};

const defaultSerializers: Required<WaitTelemetrySerializerOptions> = {
  start(event) {
    return {
      key: event.key,
      timeoutMs: event.timeoutMs,
      intervalMs: event.intervalMs,
      startedAt: event.startedAt,
      metadata: cloneValue(event.metadata)
    } satisfies Record<string, unknown>;
  },
  attempt(event) {
    return {
      key: event.key,
      timeoutMs: event.timeoutMs,
      intervalMs: event.intervalMs,
      pollCount: event.pollCount,
      elapsedMs: event.elapsedMs,
      strategyHistory: [...event.strategyHistory],
      success: event.success,
      metadata: cloneValue(event.metadata)
    } satisfies Record<string, unknown>;
  },
  heartbeat(event) {
    return {
      key: event.key,
      timeoutMs: event.timeoutMs,
      intervalMs: event.intervalMs,
      pollCount: event.pollCount,
      elapsedMs: event.elapsedMs,
      remainingMs: event.remainingMs,
      staleRecoveries: event.staleRecoveries,
      predicateSnapshot: cloneValue(event.predicateSnapshot),
      metadata: cloneValue(event.metadata)
    } satisfies Record<string, unknown>;
  },
  success(event) {
    const result = event.result;
    return {
      key: result.key,
      timeoutMs: event.timeoutMs,
      intervalMs: event.intervalMs,
      pollCount: result.pollCount,
      elapsedMs: result.elapsedMs,
      strategyHistory: [...result.strategyHistory],
      staleRecoveries: result.staleRecoveries,
      predicateSnapshot: cloneValue(result.predicateSnapshot),
      idleSnapshot: cloneValue(result.idleSnapshot),
      metadata: cloneValue(event.metadata)
    } satisfies Record<string, unknown>;
  },
  failure(event) {
    const error = event.error;
    return {
      key: error.key,
      timeoutMs: event.timeoutMs,
      intervalMs: event.intervalMs,
      pollCount: error.pollCount,
      elapsedMs: error.elapsedMs,
      strategyHistory: [...error.strategyHistory],
      staleRecoveries: error.staleRecoveries ?? 0,
      code: error.code,
      message: error.message,
      metadata: cloneValue(event.metadata)
    } satisfies Record<string, unknown>;
  }
};

export function defaultFailureNarrative(error: WaitError): string {
  const base = buildDefaultFailureMessage(error);
  const guidance = DEFAULT_GUIDANCE[error.code] ?? DEFAULT_GUIDANCE.default;
  return guidance ? `${base}. Guidance: ${guidance}` : base;
}

export function createWaitTelemetryAdapter(options: WaitTelemetryAdapterOptions = {}): WaitTelemetry {
  const {
    logger,
    basePayload = {},
    debug = false,
    notify,
    serializers,
    transformPayload,
    buildFailureNarrative: narrativeFactory,
    eventPrefix = DEFAULT_WAIT_EVENT_PREFIX
  } = options;

  const resolvedSerializers = {
    start: serializers?.start ?? defaultSerializers.start,
    attempt: serializers?.attempt ?? defaultSerializers.attempt,
    heartbeat: serializers?.heartbeat ?? defaultSerializers.heartbeat,
    success: serializers?.success ?? defaultSerializers.success,
    failure: serializers?.failure ?? defaultSerializers.failure
  } satisfies Required<WaitTelemetrySerializerOptions>;

  const buildNarrative = narrativeFactory ?? defaultFailureNarrative;

  const emit = (
    kind: WaitTelemetryEventKind,
    level: WaitTelemetryLogLevel,
    payload: Record<string, unknown> | undefined
  ): void => {
    const eventName = `${eventPrefix}:${kind}`;
    const merged = mergePayload(basePayload, payload);
    const transformed = transformPayload ? transformPayload({ ...merged }, kind) : merged;

    if (logger && typeof logger[level] === "function") {
      try {
        logger[level]?.(eventName, transformed);
      } catch {
        // ignore logger failures to preserve wait flow
      }
    }

    if (notify) {
      try {
        notify({ kind, level, event: eventName, payload: transformed });
      } catch {
        // ignore notifier failures to avoid breaking waits
      }
    }
  };

  return {
    onStart(event) {
      emit("start", "info", resolvedSerializers.start(event));
    },
    onAttempt(event) {
      if (!debug) {
        return;
      }
      emit("attempt", "debug", resolvedSerializers.attempt(event));
    },
    onHeartbeat(event) {
      emit("heartbeat", "info", resolvedSerializers.heartbeat(event));
    },
    onSuccess(event) {
      emit("success", "info", resolvedSerializers.success(event));
    },
    onFailure(event) {
      const payload = {
        ...resolvedSerializers.failure(event),
        narrative: buildNarrative(event.error)
      } satisfies Record<string, unknown>;
      emit("failure", "warn", payload);
    }
  } satisfies WaitTelemetry;
}

function buildDefaultFailureMessage(error: WaitError): string {
  switch (error.code) {
    case "resolver-miss":
      return "Wait resolver missed after retries";
    case "idle-window-exceeded":
      return "Idle window exceeded before settling";
    case "visibility-mismatch":
      return "Visibility predicate was not satisfied";
    case "timeout":
    default:
      return "Wait timed out before completion";
  }
}

function mergePayload(
  basePayload: Record<string, unknown>,
  payload: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!payload) {
    return { ...basePayload };
  }

  return {
    ...basePayload,
    ...payload
  } satisfies Record<string, unknown>;
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneValue(entry)) as unknown as T;
  }

  if (value && typeof value === "object") {
    if (isDomElement(value)) {
      return null as unknown as T;
    }

    const entries = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};

    Object.entries(entries).forEach(([key, entry]) => {
      output[key] = cloneValue(entry);
    });

    return output as T;
  }

  return value;
}

function isDomElement(value: unknown): value is Element {
  return typeof Element !== "undefined" && value instanceof Element;
}
