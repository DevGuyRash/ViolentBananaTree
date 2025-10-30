import { maskText } from "../sanitize";
import type { ScrollUntilStopCondition } from "./until";

export type RecorderScrollMode = ScrollUntilStopCondition["kind"];

export interface RecorderScrollContainerInfo {
  strategy?: string;
  key?: string;
  fallbackKeys?: string[];
  css?: string;
  xpath?: string;
  hints?: string[];
  anchorKey?: string;
  anchorCss?: string;
  anchorXPath?: string;
}

export interface RecorderScrollTuningInfo {
  stepPx?: number;
  maxAttempts?: number;
  delayMs?: number;
  timeoutMs?: number;
  minDeltaPx?: number;
}

export interface RecorderScrollPredicateInfo {
  id?: string;
  expression?: string;
  summary?: string;
}

export interface RecorderScrollTelemetryInfo {
  runId?: string;
}

export interface RecorderScrollContext {
  source: "recorder";
  mode: RecorderScrollMode;
  stop: ScrollUntilStopCondition;
  container?: RecorderScrollContainerInfo;
  tuning?: RecorderScrollTuningInfo;
  predicate?: RecorderScrollPredicateInfo;
  notes?: string[];
  telemetry?: RecorderScrollTelemetryInfo;
}

export interface RecorderScrollAnnotation {
  source: "recorder";
  mode: RecorderScrollMode;
  stop: ScrollUntilStopCondition;
  container?: RecorderScrollContainerInfo;
  tuning?: RecorderScrollTuningInfo;
  predicate?: RecorderScrollPredicateInfo;
  telemetry?: RecorderScrollTelemetryInfo;
  notes?: string[];
  guidance: string[];
}

export interface RecorderScrollCaptureHooks {
  setStop(condition: ScrollUntilStopCondition): void;
  setContainer(container: RecorderScrollContainerInfo): void;
  setTuning(tuning: RecorderScrollTuningInfo): void;
  setPredicate(predicate: RecorderScrollPredicateInfo): void;
  addNote(note: string): void;
  setTelemetry(telemetry: RecorderScrollTelemetryInfo): void;
  finalize(): RecorderScrollContext;
}

export function registerCaptureHooks(initial?: Partial<RecorderScrollContext>): RecorderScrollCaptureHooks {
  const context: RecorderScrollContext = sanitizeContext({
    source: "recorder",
    mode: initial?.mode ?? initial?.stop?.kind ?? "end",
    stop: normalizeStop(initial?.stop),
    container: initial?.container ? { ...initial.container } : undefined,
    tuning: initial?.tuning ? { ...initial.tuning } : undefined,
    predicate: initial?.predicate ? { ...initial.predicate } : undefined,
    notes: initial?.notes ? [...initial.notes] : undefined,
    telemetry: initial?.telemetry ? { ...initial.telemetry } : undefined
  });

  return {
    setStop(condition) {
      context.stop = normalizeStop(condition);
      context.mode = context.stop.kind;
    },
    setContainer(container) {
      context.container = {
        ...(context.container ?? {}),
        ...container
      } satisfies RecorderScrollContainerInfo;
      context.container = sanitizeContainer(context.container);
    },
    setTuning(tuning) {
      context.tuning = {
        ...(context.tuning ?? {}),
        ...normalizeTuning(tuning)
      } satisfies RecorderScrollTuningInfo;
    },
    setPredicate(predicate) {
      context.predicate = sanitizePredicate({
        ...(context.predicate ?? {}),
        ...predicate
      });
    },
    addNote(note) {
      if (!note) {
        return;
      }
      context.notes = dedupeList([...(context.notes ?? []), note]);
    },
    setTelemetry(telemetry) {
      context.telemetry = sanitizeTelemetry({
        ...(context.telemetry ?? {}),
        ...telemetry
      });
    },
    finalize() {
      return sanitizeContext({ ...context });
    }
  } satisfies RecorderScrollCaptureHooks;
}

export function isRecorderScrollContext(value: unknown): value is RecorderScrollContext {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as { source?: unknown; mode?: unknown; stop?: unknown };
  if (candidate.source !== "recorder") {
    return false;
  }

  if (!candidate.stop || typeof candidate.stop !== "object") {
    return false;
  }

  if (typeof candidate.mode !== "string") {
    return false;
  }

  return true;
}

export function hydrateReplayContext(context: RecorderScrollContext | undefined): RecorderScrollContext | undefined {
  if (!context) {
    return undefined;
  }

  return sanitizeContext({ ...context });
}

export function formatAnnotations(context: RecorderScrollContext | undefined): RecorderScrollAnnotation | undefined {
  if (!context) {
    return undefined;
  }

  const sanitized = sanitizeContext({ ...context });
  const guidance = buildGuidance(sanitized);

  return {
    source: "recorder",
    mode: sanitized.mode,
    stop: sanitized.stop,
    container: sanitized.container,
    tuning: sanitized.tuning,
    predicate: sanitized.predicate,
    telemetry: sanitized.telemetry,
    notes: sanitized.notes,
    guidance
  } satisfies RecorderScrollAnnotation;
}

function sanitizeContext(input: RecorderScrollContext): RecorderScrollContext {
  const stop = normalizeStop(input.stop);
  return {
    source: "recorder",
    mode: stop.kind,
    stop,
    container: sanitizeContainer(input.container),
    tuning: normalizeTuning(input.tuning),
    predicate: sanitizePredicate(input.predicate),
    notes: input.notes ? dedupeList(input.notes) : undefined,
    telemetry: sanitizeTelemetry(input.telemetry)
  } satisfies RecorderScrollContext;
}

function sanitizeContainer(container?: RecorderScrollContainerInfo): RecorderScrollContainerInfo | undefined {
  if (!container) {
    return undefined;
  }

  const sanitized: RecorderScrollContainerInfo = {};

  if (container.strategy) {
    sanitized.strategy = container.strategy;
  }

  if (container.key) {
    sanitized.key = maskKey(container.key);
  }

  if (Array.isArray(container.fallbackKeys) && container.fallbackKeys.length > 0) {
    sanitized.fallbackKeys = dedupeList(container.fallbackKeys.map((key) => maskKey(key)).filter(Boolean) as string[]);
  }

  if (container.css) {
    sanitized.css = maskSelector(container.css);
  }

  if (container.xpath) {
    sanitized.xpath = maskSelector(container.xpath);
  }

  if (Array.isArray(container.hints) && container.hints.length > 0) {
    sanitized.hints = dedupeList(container.hints);
  }

  if (container.anchorKey) {
    sanitized.anchorKey = maskKey(container.anchorKey);
  }

  if (container.anchorCss) {
    sanitized.anchorCss = maskSelector(container.anchorCss);
  }

  if (container.anchorXPath) {
    sanitized.anchorXPath = maskSelector(container.anchorXPath);
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function normalizeTuning(tuning?: RecorderScrollTuningInfo): RecorderScrollTuningInfo | undefined {
  if (!tuning) {
    return undefined;
  }

  const normalized: RecorderScrollTuningInfo = {};

  if (isFiniteNumber(tuning.stepPx)) {
    normalized.stepPx = Math.max(0, Math.floor(tuning.stepPx!));
  }

  if (isFiniteNumber(tuning.maxAttempts)) {
    normalized.maxAttempts = Math.max(0, Math.floor(tuning.maxAttempts!));
  }

  if (isFiniteNumber(tuning.delayMs)) {
    normalized.delayMs = Math.max(0, Math.floor(tuning.delayMs!));
  }

  if (isFiniteNumber(tuning.timeoutMs)) {
    normalized.timeoutMs = Math.max(0, Math.floor(tuning.timeoutMs!));
  }

  if (isFiniteNumber(tuning.minDeltaPx)) {
    normalized.minDeltaPx = Math.max(0, Math.floor(tuning.minDeltaPx!));
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function sanitizePredicate(predicate?: RecorderScrollPredicateInfo): RecorderScrollPredicateInfo | undefined {
  if (!predicate) {
    return undefined;
  }

  const sanitized: RecorderScrollPredicateInfo = {};

  if (predicate.id) {
    sanitized.id = maskKey(predicate.id);
  }

  if (predicate.expression) {
    sanitized.expression = maskSelector(predicate.expression);
  }

  if (predicate.summary) {
    sanitized.summary = predicate.summary;
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function sanitizeTelemetry(telemetry?: RecorderScrollTelemetryInfo): RecorderScrollTelemetryInfo | undefined {
  if (!telemetry) {
    return undefined;
  }

  const sanitized: RecorderScrollTelemetryInfo = {};

  if (telemetry.runId) {
    sanitized.runId = maskKey(telemetry.runId);
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function dedupeList(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
  }

  return output;
}

function maskKey(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  if (SENSITIVE_KEY_PATTERN.test(value)) {
    return maskSelector(value);
  }

  return value;
}

function maskSelector(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return maskText(value) ?? undefined;
}

function normalizeStop(stop: ScrollUntilStopCondition | undefined): ScrollUntilStopCondition {
  if (!stop || typeof stop !== "object") {
    return { kind: "end" } satisfies ScrollUntilStopCondition;
  }

  switch (stop.kind) {
    case "end":
      return {
        kind: "end",
        thresholdPx: isFiniteNumber((stop as { thresholdPx?: number }).thresholdPx)
          ? Math.max(0, Math.floor((stop as { thresholdPx: number }).thresholdPx))
          : undefined
      } satisfies ScrollUntilStopCondition;
    case "element":
      return {
        kind: "element",
        key: maskKey((stop as { key?: string }).key),
        css: maskSelector((stop as { css?: string }).css),
        xpath: maskSelector((stop as { xpath?: string }).xpath)
      } satisfies ScrollUntilStopCondition;
    case "list-growth":
      return {
        kind: "list-growth",
        parentKey: maskKey((stop as { parentKey?: string }).parentKey),
        itemCss: maskSelector((stop as { itemCss?: string }).itemCss),
        minDelta: isFiniteNumber((stop as { minDelta?: number }).minDelta)
          ? Math.max(1, Math.floor((stop as { minDelta: number }).minDelta))
          : undefined
      } satisfies ScrollUntilStopCondition;
    case "predicate":
      return {
        kind: "predicate",
        id: maskKey((stop as { id?: string }).id),
        expression: maskSelector((stop as { expression?: string }).expression)
      } satisfies ScrollUntilStopCondition;
    default:
      return { kind: "end" } satisfies ScrollUntilStopCondition;
  }
}

function buildGuidance(context: RecorderScrollContext): string[] {
  const guidance: string[] = [];
  guidance.push(`Recorder scroll ${context.mode.replace(/-/g, " ")}`);

  if (context.container?.strategy) {
    guidance.push(`Container strategy: ${context.container.strategy}`);
  }

  if (context.tuning?.stepPx) {
    guidance.push(`Step size: ${context.tuning.stepPx}px`);
  }

  if (context.tuning?.timeoutMs) {
    guidance.push(`Timeout: ${context.tuning.timeoutMs}ms`);
  }

  if (context.tuning?.maxAttempts) {
    guidance.push(`Max attempts: ${context.tuning.maxAttempts}`);
  }

  if (context.predicate?.summary) {
    guidance.push(context.predicate.summary);
  }

  if (!guidance.some((entry) => entry.startsWith("Recorder scroll"))) {
    guidance.unshift(`Recorder scroll ${context.mode}`);
  }

  return dedupeList(guidance);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

const SENSITIVE_KEY_PATTERN = /(password|secret|token|auth|cookie|session|credential)/i;
