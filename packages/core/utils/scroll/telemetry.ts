import type {
  ScrollUntilResult,
  ScrollUntilTelemetry,
  ScrollUntilTelemetryAttemptEvent,
  ScrollUntilTelemetryStartEvent,
  ScrollUntilStatus
} from "./until";
import { maskText } from "../sanitize";

export type ScrollTelemetryEventKind = "start" | "attempt" | "success" | "failure" | "no_change";

export type ScrollTelemetryLogLevel = "debug" | "info" | "warn" | "error";

export interface ScrollTelemetryEventEnvelope {
  kind: ScrollTelemetryEventKind;
  level: ScrollTelemetryLogLevel;
  event: string;
  payload: Record<string, unknown>;
}

export type ScrollTelemetryNotifier = (event: ScrollTelemetryEventEnvelope) => void;

export interface ScrollTelemetryLogger {
  debug?(event: string, payload: Record<string, unknown>): void;
  info?(event: string, payload: Record<string, unknown>): void;
  warn?(event: string, payload: Record<string, unknown>): void;
  error?(event: string, payload: Record<string, unknown>): void;
}

export interface ScrollTelemetryAdapterOptions {
  basePayload?: Record<string, unknown>;
  logger?: ScrollTelemetryLogger | null;
  notify?: ScrollTelemetryNotifier;
  includeAttempts?: boolean;
  eventPrefix?: string;
  transformPayload?: (
    payload: Record<string, unknown>,
    kind: ScrollTelemetryEventKind
  ) => Record<string, unknown>;
  maskSelectors?: boolean;
  buildNarrative?: (result: ScrollUntilResult) => string | undefined;
}

export const DEFAULT_SCROLL_EVENT_PREFIX = "[DGX] scroll";

interface SanitizerOptions {
  maskSelectors: boolean;
}

export function createScrollTelemetryAdapter(options: ScrollTelemetryAdapterOptions = {}): ScrollUntilTelemetry {
  const sanitizeOptions: SanitizerOptions = {
    maskSelectors: options.maskSelectors ?? true
  } satisfies SanitizerOptions;

  const basePayload = sanitizePayload({ ...(options.basePayload ?? {}) }, sanitizeOptions);
  const logger = options.logger ?? null;
  const notify = options.notify;
  const includeAttempts = options.includeAttempts ?? true;
  const eventPrefix = options.eventPrefix ?? DEFAULT_SCROLL_EVENT_PREFIX;
  const transformPayload = options.transformPayload;
  const buildNarrative = options.buildNarrative ?? defaultFailureNarrative;

  let lastStart: ScrollUntilTelemetryStartEvent | null = null;
  let lastAttempt: ScrollUntilTelemetryAttemptEvent | null = null;

  const emit = (
    kind: ScrollTelemetryEventKind,
    level: ScrollTelemetryLogLevel,
    payload: Record<string, unknown>
  ): void => {
    const eventName = `${eventPrefix}:${kind}`;
    const merged = { ...basePayload, ...payload } satisfies Record<string, unknown>;
    const sanitized = sanitizePayload(merged, sanitizeOptions);
    const transformed = transformPayload ? transformPayload({ ...sanitized }, kind) : sanitized;

    if (logger && typeof logger[level] === "function") {
      try {
        logger[level]?.(eventName, transformed);
      } catch {
        // ignore logger failures to keep scroll execution intact
      }
    }

    if (notify) {
      try {
        notify({
          kind,
          level,
          event: eventName,
          payload: transformed
        });
      } catch {
        // ignore notifier failures to preserve telemetry flow
      }
    }
  };

  return {
    onStart(event) {
      lastStart = event;
      lastAttempt = null;

      emit("start", "info", {
        runId: event.runId,
        mode: event.mode,
        startedAt: event.startedAt,
        config: event.config,
        metadata: event.metadata,
        containerStrategy: event.containerStrategy,
        timestamp: now()
      });
    },
    onAttempt(event) {
      lastAttempt = event;

      if (event.status !== "continue") {
        return;
      }

      if (!includeAttempts) {
        return;
      }

      emit("attempt", "info", {
        runId: event.runId,
        attempt: event.attempt,
        elapsedMs: event.elapsedMs,
        delta: event.delta,
        cumulativeDelta: event.cumulativeDelta,
        status: event.status,
        reason: event.reason,
        snapshot: event.snapshot,
        domStable: event.domStable,
        timestamp: now()
      });
    },
    onComplete(event) {
      const result = event.result;
      const last = lastAttempt;

      const payload = {
        runId: result.runId,
        status: result.status,
        attempts: result.attempts,
        attempt: last?.attempt ?? result.attempts,
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
        elapsedMs: result.elapsedMs,
        reason: result.reason,
        domStable: result.domStable,
        consecutiveNoChange: result.consecutiveNoChange,
        lastDelta: result.lastDelta,
        cumulativeDelta: result.cumulativeDelta,
        predicateSnapshot: result.predicateSnapshot ?? last?.snapshot,
        delta: last?.delta ?? result.lastDelta,
        metadata: result.metadata,
        containerStrategy: lastStart?.containerStrategy,
        config: result.config,
        timestamp: now()
      } satisfies Record<string, unknown>;

      const kind = resolveResultKind(result.status);
      const level = resolveResultLevel(result.status);
      const narrative = buildNarrative(result);

      if (typeof narrative === "string" && narrative.length > 0) {
        payload.narrative = narrative;
      }

      emit(kind, level, payload);
    }
  } satisfies ScrollUntilTelemetry;
}

function resolveResultKind(status: ScrollUntilStatus): ScrollTelemetryEventKind {
  if (status === "success") {
    return "success";
  }

  if (status === "no_change") {
    return "no_change";
  }

  return "failure";
}

function resolveResultLevel(status: ScrollUntilStatus): ScrollTelemetryLogLevel {
  switch (status) {
    case "success":
      return "info";
    case "no_change":
    case "cancelled":
      return "warn";
    case "timeout":
    case "predicate_error":
    case "container_unavailable":
    default:
      return "error";
  }
}

function defaultFailureNarrative(result: ScrollUntilResult): string | undefined {
  if (result.status === "success") {
    return undefined;
  }

  const reason = result.reason ?? "";

  switch (result.status) {
    case "no_change":
      return reason ? `Scroll stopped after no change (${reason}).` : "Scroll stopped after no change.";
    case "timeout":
      return reason ? `Scroll timed out (${reason}).` : "Scroll timed out before reaching target.";
    case "predicate_error":
      return reason ? `Scroll predicate failed (${reason}).` : "Scroll predicate failed before completion.";
    case "cancelled":
      return reason ? `Scroll was cancelled (${reason}).` : "Scroll was cancelled.";
    case "container_unavailable":
      return reason ? `Scroll container unavailable (${reason}).` : "Scroll container could not be resolved.";
    default:
      return reason || undefined;
  }
}

function sanitizePayload(payload: Record<string, unknown>, options: SanitizerOptions): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  Object.entries(payload).forEach(([key, value]) => {
    if (typeof value === "undefined") {
      return;
    }
    output[key] = sanitizeValue(value, key, options);
  });

  return output;
}

function sanitizeValue(value: unknown, key: string, options: SanitizerOptions): unknown {
  if (value === null || typeof value === "undefined") {
    return value ?? null;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, key, options));
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Map) {
    const entries: Array<{ key: unknown; value: unknown }> = [];
    value.forEach((mapValue, mapKey) => {
      entries.push({
        key: sanitizeValue(mapKey, key, options),
        value: sanitizeValue(mapValue, key, options)
      });
    });
    return entries;
  }

  if (value instanceof Set) {
    const entries: unknown[] = [];
    value.forEach((entry) => {
      entries.push(sanitizeValue(entry, key, options));
    });
    return entries;
  }

  if (typeof value === "function") {
    return "[function]";
  }

  if (isDomElement(value)) {
    return {
      tag: resolveElementTag(value)
    } satisfies Record<string, unknown>;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeValue(value.message, key, options),
      stack: undefined
    } satisfies Record<string, unknown>;
  }

  if (typeof value === "object") {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};

    Object.entries(input).forEach(([entryKey, entryValue]) => {
      if (typeof entryValue === "undefined") {
        return;
      }
      output[entryKey] = sanitizeValue(entryValue, entryKey, options);
    });

    return output;
  }

  if (typeof value === "string") {
    if (shouldMaskKey(key, options)) {
      return maskText(value) ?? null;
    }
    return value;
  }

  if (shouldMaskKey(key, options)) {
    return maskText(String(value)) ?? null;
  }

  return value;
}

function shouldMaskKey(key: string, options: SanitizerOptions): boolean {
  if (!options.maskSelectors) {
    return false;
  }

  if (SELECTOR_KEY_PATTERN.test(key)) {
    return true;
  }

  if (SECRET_KEY_PATTERN.test(key)) {
    return true;
  }

  return false;
}

const SELECTOR_KEY_PATTERN = /(selector|css|xpath)$/i;
const SECRET_KEY_PATTERN = /(password|secret|token|auth|cookie|session)/i;

function isDomElement(value: unknown): value is Element {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (typeof Element !== "undefined") {
    return value instanceof Element;
  }

  return (value as { nodeType?: number }).nodeType === 1;
}

function resolveElementTag(element: Element): string {
  try {
    const tag = (element as { tagName?: string }).tagName;
    return typeof tag === "string" && tag.length > 0 ? tag.toLowerCase() : "element";
  } catch {
    return "element";
  }
}

function now(): number {
  return Date.now();
}
