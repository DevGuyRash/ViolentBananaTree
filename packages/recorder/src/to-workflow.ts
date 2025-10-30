import { maskValue, SENSITIVE_KEY_PATTERN } from "../../workflows/src/actions/shared";
import {
  DEFAULT_WAIT_INTERVAL_MS,
  DEFAULT_WAIT_TIMEOUT_MS
} from "../../core/utils/wait";
import {
  formatAnnotations as formatScrollAnnotations,
  hydrateReplayContext,
  type RecorderScrollAnnotation,
  type RecorderScrollContext
} from "../../core/utils/scroll/recording";
import type { WaitActionKind } from "../../workflows/src/actions/wait";
import type {
  ScrollUntilOptions,
  ScrollUntilStep,
  ScrollUntilStopCondition,
  WaitForIdleStep,
  WaitForStep,
  WaitHiddenStep,
  WaitTextStep,
  WaitVisibleStep,
  WorkflowStep
} from "../../workflows/src/types";
import type { RecorderScrollCaptureResult } from "./session";

const WAIT_TAG_BASE = "recorder:wait";

type WaitStep = WaitForStep | WaitTextStep | WaitVisibleStep | WaitHiddenStep | WaitForIdleStep;

export type RecordedWaitKind = "waitFor" | "waitText" | "waitVisible" | "waitHidden" | "waitForIdle";

export interface RecordedWaitHints {
  presenceThreshold?: number;
  scrollerKey?: string;
  staleRetryCap?: number;
}

export interface RecordedIdleConfig {
  idleMs?: number;
  maxWindowMs?: number;
  heartbeatMs?: number;
  captureStatistics?: boolean;
}

export interface RecordedWaitBudgetConfig {
  timeoutMs?: number;
  intervalMs?: number;
}

export type RecordedWaitPredicate =
  | {
      kind: "text";
      expected: string;
      exact?: boolean;
      caseSensitive?: boolean;
      scopeKey?: string;
      textSensitive?: boolean;
    }
  | {
      kind: "visible";
      requireDisplayed?: boolean;
      requireInViewport?: boolean;
      minOpacity?: number;
      minIntersectionRatio?: number;
      minBoundingBoxArea?: number;
      scopeKey?: string;
    }
  | {
      kind: "hidden";
      requireDisplayed?: boolean;
      requireInViewport?: boolean;
      minOpacity?: number;
      minIntersectionRatio?: number;
      minBoundingBoxArea?: number;
      scopeKey?: string;
    }
  | {
      kind: "idle";
      scopeKey?: string;
      idle?: RecordedIdleConfig;
    }
  | {
      kind: "resolver";
      key?: string;
      css?: string;
      xpath?: string;
      textContains?: string;
      exact?: boolean;
      visible?: boolean;
      scopeKey?: string;
      textSensitive?: boolean;
    };

export interface RecordedWaitExport {
  kind: RecordedWaitKind;
  key?: string;
  predicate: RecordedWaitPredicate;
  hints?: RecordedWaitHints;
  budgets?: RecordedWaitBudgetConfig;
  debug?: boolean;
  notes?: string[];
}

export interface RecorderWaitExportResult {
  step: WaitStep;
  annotations: WaitAnnotations;
}

export interface WaitAnnotations {
  source: "recorder";
  kind: WaitActionKind;
  predicate: Record<string, unknown>;
  resolver: Record<string, unknown>;
  hints: RecordedWaitHints;
  idle?: RecordedIdleConfig;
  budgets: { timeoutMs: number; intervalMs: number };
  guidance: string[];
  notes?: string[];
}

export interface RecordedScrollExport extends RecorderScrollCaptureResult {
  kind: "scrollUntil";
}

export interface RecorderScrollExportResult {
  step: ScrollUntilStep;
  annotations?: RecorderScrollAnnotation;
  context: RecorderScrollContext;
}

export interface RecorderWorkflowExportInputStep {
  kind: "wait" | "scroll" | "passthrough";
  wait?: RecordedWaitExport;
  scroll?: RecordedScrollExport;
  step?: WorkflowStep;
}

export interface RecorderWorkflowExportResult {
  steps: WorkflowStep[];
  waitAnnotations: WaitAnnotations[];
  scrollAnnotations: RecorderScrollAnnotation[];
}

export function exportRecorderWorkflowSteps(steps: RecorderWorkflowExportInputStep[]): RecorderWorkflowExportResult {
  const exported: WorkflowStep[] = [];
  const annotations: WaitAnnotations[] = [];
  const scrollAnnotations: RecorderScrollAnnotation[] = [];

  steps.forEach((entry) => {
    if (entry.kind === "wait" && entry.wait) {
      const wait = buildWaitStep(entry.wait);
      exported.push(wait.step);
      annotations.push(wait.annotations);
      return;
    }

    if (entry.kind === "scroll" && entry.scroll) {
      const scroll = buildScrollStep(entry.scroll);
      exported.push(scroll.step);
      if (scroll.annotations) {
        scrollAnnotations.push(scroll.annotations);
      }
      return;
    }

    if (entry.step) {
      exported.push(entry.step);
    }
  });

  return {
    steps: exported,
    waitAnnotations: annotations,
    scrollAnnotations
  } satisfies RecorderWorkflowExportResult;
}

export function buildWaitStep(entry: RecordedWaitExport): RecorderWaitExportResult {
  const budgets = resolveBudgets(entry.budgets);
  const hints = resolveHints(entry.hints);
  const guidance = buildGuidance(entry, hints);
  const annotations: WaitAnnotations = {
    source: "recorder",
    kind: entry.kind,
    predicate: buildPredicateAnnotation(entry.predicate),
    resolver: buildResolverAnnotation(entry),
    hints,
    idle: resolveIdle(entry.predicate),
    budgets,
    guidance,
    notes: entry.notes && entry.notes.length > 0 ? [...entry.notes] : undefined
  } satisfies WaitAnnotations;

  const description = guidance[0];
  const tags = buildTags(entry.kind, hints, annotations.idle);
  const name = buildName(entry, annotations.predicate);

  const step = createWaitStep(entry, hints, annotations, name, description, tags);

  return {
    step,
    annotations
  } satisfies RecorderWaitExportResult;
}

export function buildScrollStep(entry: RecordedScrollExport): RecorderScrollExportResult {
  const baseContext = hydrateReplayContext(entry.context) ?? entry.context;
  const context = mergeScrollNotes(baseContext, entry.notes);
  const annotations = formatScrollAnnotations(context);
  const options = buildScrollOptions(context, entry);
  const step = createScrollStep(entry, options, annotations);

  return {
    step,
    annotations,
    context
  } satisfies RecorderScrollExportResult;
}

function createScrollStep(
  entry: RecordedScrollExport,
  options: ScrollUntilOptions,
  scrollAnnotations?: RecorderScrollAnnotation
): ScrollUntilStep {
  const step: ScrollUntilStep = {
    kind: "scrollUntil",
    options
  } satisfies ScrollUntilStep;

  if (entry.id) {
    step.id = entry.id;
  }

  if (entry.name) {
    step.name = entry.name;
  }

  if (entry.description) {
    step.description = entry.description;
  }

  if (entry.tags && entry.tags.length > 0) {
    step.tags = dedupeStrings(entry.tags);
  }

  if (typeof entry.debug === "boolean") {
    step.debug = entry.debug;
  }

  if (typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs)) {
    step.timeoutMs = options.timeoutMs;
  }

  const annotations = composeScrollAnnotations(entry.annotations, scrollAnnotations);
  if (annotations) {
    step.annotations = annotations;
  }

  return step;
}

function composeScrollAnnotations(
  base: Record<string, unknown> | undefined,
  scrollAnnotation?: RecorderScrollAnnotation
): Record<string, unknown> | undefined {
  if (!scrollAnnotation && !base) {
    return undefined;
  }

  const payload = base ? { ...base } : {} satisfies Record<string, unknown>;

  if (scrollAnnotation) {
    payload.scroll = scrollAnnotation;
  }

  return Object.keys(payload).length > 0 ? payload : undefined;
}

function mergeScrollNotes(context: RecorderScrollContext, notes?: string[]): RecorderScrollContext {
  if (!Array.isArray(notes) || notes.length === 0) {
    return context;
  }

  const merged = dedupeStrings([...(context.notes ?? []), ...notes]);

  if (merged.length === 0) {
    if (context.notes && context.notes.length > 0) {
      const next = { ...context } satisfies RecorderScrollContext;
      delete (next as { notes?: string[] }).notes;
      return next;
    }
    return context;
  }

  if (!context.notes || !arraysEqual(context.notes, merged)) {
    return {
      ...context,
      notes: merged
    } satisfies RecorderScrollContext;
  }

  return context;
}

function buildScrollOptions(context: RecorderScrollContext, entry: RecordedScrollExport): ScrollUntilOptions {
  const overrides = sanitizeScrollOverrides(entry.options);
  const metadataOverride = overrides.metadata;
  const telemetryOverride = overrides.telemetry;

  const recorderMetadata: Record<string, unknown> = {
    scroll: cloneMetadataValue(context)
  } satisfies Record<string, unknown>;

  if (context.telemetry?.runId) {
    recorderMetadata.telemetry = {
      runId: context.telemetry.runId
    } satisfies Record<string, unknown>;
  }

  const metadata = mergeMetadataRecords(
    { recorder: recorderMetadata },
    entry.metadata,
    metadataOverride
  );

  const base: Partial<ScrollUntilOptions> = {
    until: context.stop,
    containerKey: context.container?.key,
    containerCss: context.container?.css,
    containerXPath: context.container?.xpath,
    containerFallbackKeys: context.container?.fallbackKeys,
    anchorKey: context.container?.anchorKey,
    anchorCss: context.container?.anchorCss,
    anchorXPath: context.container?.anchorXPath,
    stepPx: context.tuning?.stepPx,
    maxAttempts: context.tuning?.maxAttempts,
    delayMs: context.tuning?.delayMs,
    timeoutMs: context.tuning?.timeoutMs,
    minDeltaPx: context.tuning?.minDeltaPx,
    telemetry: telemetryOverride
  } satisfies Partial<ScrollUntilOptions>;

  delete overrides.metadata;
  delete overrides.telemetry;

  const merged: Partial<ScrollUntilOptions> = {
    ...base,
    ...overrides
  } satisfies Partial<ScrollUntilOptions>;

  if (metadata) {
    merged.metadata = metadata;
  }

  return pruneUndefinedScrollOptions(merged);
}

function sanitizeScrollOverrides(
  input?: Partial<ScrollUntilOptions>
): Partial<ScrollUntilOptions> & { metadata?: Record<string, unknown> } {
  if (!input) {
    return {};
  }

  const output: Partial<ScrollUntilOptions> & { metadata?: Record<string, unknown> } = {};

  if (typeof input.containerKey === "string" && input.containerKey.length > 0) {
    output.containerKey = input.containerKey;
  }

  if (Array.isArray(input.containerFallbackKeys) && input.containerFallbackKeys.length > 0) {
    output.containerFallbackKeys = dedupeStrings(input.containerFallbackKeys.filter((value): value is string => typeof value === "string" && value.length > 0));
  }

  if (typeof input.containerCss === "string" && input.containerCss.length > 0) {
    output.containerCss = maskValue(input.containerCss);
  }

  if (typeof input.containerXPath === "string" && input.containerXPath.length > 0) {
    output.containerXPath = maskValue(input.containerXPath);
  }

  if (typeof input.anchorKey === "string" && input.anchorKey.length > 0) {
    output.anchorKey = input.anchorKey;
  }

  if (typeof input.anchorCss === "string" && input.anchorCss.length > 0) {
    output.anchorCss = maskValue(input.anchorCss);
  }

  if (typeof input.anchorXPath === "string" && input.anchorXPath.length > 0) {
    output.anchorXPath = maskValue(input.anchorXPath);
  }

  if (typeof input.stepPx === "number" && Number.isFinite(input.stepPx)) {
    output.stepPx = Math.max(0, Math.floor(input.stepPx));
  }

  if (typeof input.maxAttempts === "number" && Number.isFinite(input.maxAttempts)) {
    output.maxAttempts = Math.max(0, Math.floor(input.maxAttempts));
  } else if (typeof (input as { maxSteps?: number }).maxSteps === "number" && Number.isFinite((input as { maxSteps: number }).maxSteps)) {
    output.maxAttempts = Math.max(0, Math.floor((input as { maxSteps: number }).maxSteps));
  }

  if (typeof input.delayMs === "number" && Number.isFinite(input.delayMs)) {
    output.delayMs = Math.max(0, Math.floor(input.delayMs));
  }

  if (typeof input.timeoutMs === "number" && Number.isFinite(input.timeoutMs)) {
    output.timeoutMs = Math.max(0, Math.floor(input.timeoutMs));
  }

  if (typeof input.minDeltaPx === "number" && Number.isFinite(input.minDeltaPx)) {
    output.minDeltaPx = Math.max(0, Math.floor(input.minDeltaPx));
  }

  const telemetry = sanitizeTelemetryOptions(input.telemetry);
  if (telemetry) {
    output.telemetry = telemetry;
  }

  const metadata = sanitizeMetadataRecord(input.metadata);
  if (metadata) {
    output.metadata = metadata;
  }

  return output;
}

function sanitizeTelemetryOptions(
  input: ScrollUntilOptions["telemetry"]
): ScrollUntilOptions["telemetry"] | undefined {
  if (!input) {
    return undefined;
  }

  const output: NonNullable<ScrollUntilOptions["telemetry"]> = {};

  if (typeof input.includeAttempts === "boolean") {
    output.includeAttempts = input.includeAttempts;
  }

  if (typeof input.eventPrefix === "string" && input.eventPrefix.length > 0) {
    output.eventPrefix = input.eventPrefix;
  }

  return Object.keys(output).length > 0 ? output : undefined;
}

function mergeMetadataRecords(
  ...records: Array<Record<string, unknown> | undefined>
): Record<string, unknown> | undefined {
  let merged: Record<string, unknown> | undefined;

  for (const record of records) {
    if (!record) {
      continue;
    }

    const sanitized = sanitizeMetadataRecord(record);
    if (!sanitized) {
      continue;
    }

    merged = deepMergeMetadata(merged, sanitized);
  }

  return merged;
}

function deepMergeMetadata(
  target: Record<string, unknown> | undefined,
  source: Record<string, unknown>
): Record<string, unknown> {
  if (!target) {
    target = {};
  }

  Object.entries(source).forEach(([key, value]) => {
    if (isPlainRecord(value) && isPlainRecord(target[key])) {
      target[key] = deepMergeMetadata(target[key] as Record<string, unknown>, value);
      return;
    }

    target[key] = cloneMetadataValue(value);
  });

  return target;
}

function sanitizeMetadataRecord(record?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!record) {
    return undefined;
  }

  const output: Record<string, unknown> = {};

  Object.entries(record).forEach(([key, value]) => {
    if (typeof value === "undefined" || value === null) {
      return;
    }

    output[key] = sanitizeMetadataValue(key, value);
  });

  return Object.keys(output).length > 0 ? output : undefined;
}

function sanitizeMetadataValue(key: string, value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeMetadataValue(key, entry));
  }

  if (isPlainRecord(value)) {
    const output: Record<string, unknown> = {};
    Object.entries(value).forEach(([childKey, childValue]) => {
      if (typeof childValue === "undefined" || childValue === null) {
        return;
      }
      output[childKey] = sanitizeMetadataValue(childKey, childValue);
    });
    return output;
  }

  if (typeof value === "function") {
    return "[function]";
  }

  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return maskValue(value);
  }

  return value;
}

function cloneMetadataValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneMetadataValue(entry)) as unknown as T;
  }

  if (isPlainRecord(value)) {
    const output: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
      if (typeof entry === "undefined") {
        return;
      }
      output[key] = cloneMetadataValue(entry);
    });
    return output as unknown as T;
  }

  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function pruneUndefinedScrollOptions(options: Partial<ScrollUntilOptions>): ScrollUntilOptions {
  const until = (options.until ?? { kind: "end" }) as ScrollUntilStopCondition;
  const result: ScrollUntilOptions = {
    until
  } satisfies ScrollUntilOptions;

  if (typeof options.containerKey === "string" && options.containerKey.length > 0) {
    result.containerKey = options.containerKey;
  }

  if (typeof options.containerCss === "string" && options.containerCss.length > 0) {
    result.containerCss = options.containerCss;
  }

  if (typeof options.containerXPath === "string" && options.containerXPath.length > 0) {
    result.containerXPath = options.containerXPath;
  }

  if (Array.isArray(options.containerFallbackKeys) && options.containerFallbackKeys.length > 0) {
    result.containerFallbackKeys = dedupeStrings(options.containerFallbackKeys);
  }

  if (typeof options.anchorKey === "string" && options.anchorKey.length > 0) {
    result.anchorKey = options.anchorKey;
  }

  if (typeof options.anchorCss === "string" && options.anchorCss.length > 0) {
    result.anchorCss = options.anchorCss;
  }

  if (typeof options.anchorXPath === "string" && options.anchorXPath.length > 0) {
    result.anchorXPath = options.anchorXPath;
  }

  if (typeof options.stepPx === "number" && Number.isFinite(options.stepPx)) {
    result.stepPx = options.stepPx;
  }

  if (typeof options.maxAttempts === "number" && Number.isFinite(options.maxAttempts)) {
    result.maxAttempts = options.maxAttempts;
  }

  if (typeof options.delayMs === "number" && Number.isFinite(options.delayMs)) {
    result.delayMs = options.delayMs;
  }

  if (typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs)) {
    result.timeoutMs = options.timeoutMs;
  }

  if (typeof options.minDeltaPx === "number" && Number.isFinite(options.minDeltaPx)) {
    result.minDeltaPx = options.minDeltaPx;
  }

  if (options.telemetry) {
    result.telemetry = options.telemetry;
  }

  if (options.metadata) {
    result.metadata = options.metadata;
  }

  return result;
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    output.push(trimmed);
  }

  return output;
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }

  return true;
}

function createWaitStep(
  entry: RecordedWaitExport,
  hints: RecordedWaitHints,
  annotations: WaitAnnotations,
  name: string,
  description: string | undefined,
  tags: string[]
): WaitStep {
  const baseMetadata = {
    name,
    description,
    tags,
    timeoutMs: entry.budgets?.timeoutMs,
    intervalMs: entry.budgets?.intervalMs,
    debug: entry.debug,
    annotations: { wait: annotations }
  } as const;

  switch (entry.kind) {
    case "waitText":
      return {
        ...baseMetadata,
        kind: "waitText",
        text: resolveText(entry.predicate),
        exact: withPredicate(entry.predicate, "exact"),
        caseSensitive: withPredicate(entry.predicate, "caseSensitive"),
        withinKey: withPredicate(entry.predicate, "scopeKey"),
        presenceThreshold: hints.presenceThreshold,
        scrollerKey: hints.scrollerKey,
        staleRetryCap: hints.staleRetryCap
      } satisfies WaitTextStep;
    case "waitVisible":
      return {
        ...baseMetadata,
        kind: "waitVisible",
        key: resolveKey(entry),
        scopeKey: withPredicate(entry.predicate, "scopeKey"),
        presenceThreshold: hints.presenceThreshold,
        scrollerKey: hints.scrollerKey,
        staleRetryCap: hints.staleRetryCap,
        requireDisplayed: withPredicate(entry.predicate, "requireDisplayed"),
        requireInViewport: withPredicate(entry.predicate, "requireInViewport"),
        minOpacity: withPredicate(entry.predicate, "minOpacity"),
        minIntersectionRatio: withPredicate(entry.predicate, "minIntersectionRatio"),
        minBoundingBoxArea: withPredicate(entry.predicate, "minBoundingBoxArea")
      } satisfies WaitVisibleStep;
    case "waitHidden":
      return {
        ...baseMetadata,
        kind: "waitHidden",
        key: resolveKey(entry),
        scopeKey: withPredicate(entry.predicate, "scopeKey"),
        presenceThreshold: hints.presenceThreshold,
        scrollerKey: hints.scrollerKey,
        staleRetryCap: hints.staleRetryCap,
        requireDisplayed: withPredicate(entry.predicate, "requireDisplayed"),
        requireInViewport: withPredicate(entry.predicate, "requireInViewport"),
        minOpacity: withPredicate(entry.predicate, "minOpacity"),
        minIntersectionRatio: withPredicate(entry.predicate, "minIntersectionRatio"),
        minBoundingBoxArea: withPredicate(entry.predicate, "minBoundingBoxArea")
      } satisfies WaitHiddenStep;
    case "waitForIdle":
      return {
        ...baseMetadata,
        kind: "waitForIdle",
        key: resolveKey(entry),
        scopeKey: withPredicate(entry.predicate, "scopeKey"),
        presenceThreshold: hints.presenceThreshold,
        scrollerKey: hints.scrollerKey,
        staleRetryCap: hints.staleRetryCap,
        idleMs: annotations.idle?.idleMs,
        maxWindowMs: annotations.idle?.maxWindowMs,
        heartbeatMs: annotations.idle?.heartbeatMs,
        captureStatistics: annotations.idle?.captureStatistics
      } satisfies WaitForIdleStep;
    case "waitFor":
    default:
      return {
        ...baseMetadata,
        kind: "waitFor",
        key: resolveKey(entry),
        css: withPredicate(entry.predicate, "css"),
        xpath: withPredicate(entry.predicate, "xpath"),
        text: withPredicate(entry.predicate, "textContains"),
        exact: withPredicate(entry.predicate, "exact"),
        visible: withPredicate(entry.predicate, "visible"),
        scopeKey: withPredicate(entry.predicate, "scopeKey"),
        presenceThreshold: hints.presenceThreshold,
        scrollerKey: hints.scrollerKey,
        staleRetryCap: hints.staleRetryCap
      } satisfies WaitForStep;
  }
}

function resolveBudgets(input?: RecordedWaitBudgetConfig): { timeoutMs: number; intervalMs: number } {
  const timeout = typeof input?.timeoutMs === "number" && Number.isFinite(input.timeoutMs)
    ? Math.max(0, input.timeoutMs)
    : DEFAULT_WAIT_TIMEOUT_MS;

  const interval = typeof input?.intervalMs === "number" && Number.isFinite(input.intervalMs)
    ? Math.max(0, input.intervalMs)
    : DEFAULT_WAIT_INTERVAL_MS;

  return { timeoutMs: timeout, intervalMs: interval };
}

function resolveHints(input?: RecordedWaitHints): RecordedWaitHints {
  if (!input) {
    return {};
  }

  const hints: RecordedWaitHints = {};

  if (typeof input.presenceThreshold === "number" && Number.isFinite(input.presenceThreshold) && input.presenceThreshold >= 1) {
    hints.presenceThreshold = Math.floor(input.presenceThreshold);
  }

  if (typeof input.scrollerKey === "string" && input.scrollerKey.length > 0) {
    hints.scrollerKey = input.scrollerKey;
  }

  if (typeof input.staleRetryCap === "number" && Number.isFinite(input.staleRetryCap) && input.staleRetryCap >= 0) {
    hints.staleRetryCap = Math.floor(input.staleRetryCap);
  }

  return hints;
}

function resolveIdle(predicate: RecordedWaitPredicate): RecordedIdleConfig | undefined {
  if (predicate.kind === "idle") {
    return predicate.idle ?? {};
  }

  return undefined;
}

function buildPredicateAnnotation(predicate: RecordedWaitPredicate): Record<string, unknown> {
  switch (predicate.kind) {
    case "text":
      return {
        kind: "text",
        expectedPreview: sanitizePreview(predicate.expected, predicate.textSensitive),
        exact: Boolean(predicate.exact),
        caseSensitive: Boolean(predicate.caseSensitive)
      } satisfies Record<string, unknown>;
    case "visible":
      return {
        kind: "visible",
        requireDisplayed: predicate.requireDisplayed,
        requireInViewport: predicate.requireInViewport,
        minOpacity: predicate.minOpacity,
        minIntersectionRatio: predicate.minIntersectionRatio,
        minBoundingBoxArea: predicate.minBoundingBoxArea
      } satisfies Record<string, unknown>;
    case "hidden":
      return {
        kind: "hidden",
        requireDisplayed: predicate.requireDisplayed,
        requireInViewport: predicate.requireInViewport,
        minOpacity: predicate.minOpacity,
        minIntersectionRatio: predicate.minIntersectionRatio,
        minBoundingBoxArea: predicate.minBoundingBoxArea
      } satisfies Record<string, unknown>;
    case "idle":
      return {
        kind: "idle",
        idleMs: predicate.idle?.idleMs,
        maxWindowMs: predicate.idle?.maxWindowMs
      } satisfies Record<string, unknown>;
    case "resolver":
    default:
      return {
        kind: "resolver",
        css: predicate.css,
        xpath: predicate.xpath,
        textPreview: sanitizePreview(predicate.textContains ?? "", predicate.textSensitive),
        exact: predicate.exact,
        visible: predicate.visible
      } satisfies Record<string, unknown>;
  }
}

function buildResolverAnnotation(entry: RecordedWaitExport): Record<string, unknown> {
  return {
    key: sanitizeKey(entry.key),
    scopeKey: withPredicate(entry.predicate, "scopeKey")
  } satisfies Record<string, unknown>;
}

function buildGuidance(entry: RecordedWaitExport, hints: RecordedWaitHints): string[] {
  const guidance: string[] = [];
  const budgets = resolveBudgets(entry.budgets);
  const predicate = entry.predicate;

  guidance.push(
    `Recorder wait ${entry.kind} with timeout ${budgets.timeoutMs}ms and interval ${budgets.intervalMs}ms`
  );

  if (predicate.kind === "text") {
    const mode = predicate.exact ? "exact" : predicate.caseSensitive ? "contains (case-sensitive)" : "contains";
    guidance.push(`Text predicate uses ${mode} match`);
  }

  if (predicate.kind === "visible") {
    guidance.push("Visibility predicate checks rendered state before proceeding");
  }

  if (predicate.kind === "hidden") {
    guidance.push("Hidden predicate waits for element to disappear or hide");
  }

  if (predicate.kind === "idle") {
    const idleMs = predicate.idle?.idleMs ?? 0;
    if (idleMs > 0) {
      guidance.push(`Idle window requires ${idleMs}ms of mutation silence`);
    } else {
      guidance.push("Idle predicate monitors mutation inactivity");
    }
  }

  if (hints.presenceThreshold && hints.presenceThreshold > 1) {
    guidance.push(`Presence threshold ${hints.presenceThreshold} stabilizes dynamic rendering`);
  }

  if (hints.scrollerKey) {
    guidance.push(`Scroller '${hints.scrollerKey}' will auto-scroll during retries`);
  }

  if (typeof hints.staleRetryCap === "number") {
    guidance.push(`Stale retry cap set to ${hints.staleRetryCap}`);
  }

  if (entry.debug) {
    guidance.push("Debug telemetry enabled for this wait");
  }

  return guidance;
}

function buildTags(kind: RecordedWaitKind, hints: RecordedWaitHints, idle?: RecordedIdleConfig): string[] {
  const tags = new Set<string>();
  tags.add(WAIT_TAG_BASE);
  tags.add(`${WAIT_TAG_BASE}:${kind}`);

  if (hints.presenceThreshold && hints.presenceThreshold > 1) {
    tags.add(`${WAIT_TAG_BASE}:presence`);
  }

  if (hints.scrollerKey) {
    tags.add(`${WAIT_TAG_BASE}:scroll`);
  }

  if (idle) {
    tags.add(`${WAIT_TAG_BASE}:idle`);
  }

  return Array.from(tags).sort();
}

function buildName(entry: RecordedWaitExport, predicateAnnotation: Record<string, unknown>): string {
  const kindLabel = entry.kind.replace("wait", "Wait ");
  const predicateLabel = predicateAnnotation.kind ? String(predicateAnnotation.kind) : "predicate";
  return `${kindLabel} • ${predicateLabel}`;
}

function resolveKey(entry: RecordedWaitExport): string {
  if (entry.key && entry.key.length > 0) {
    return entry.key;
  }

  if (entry.predicate.kind === "resolver" && entry.predicate.key) {
    return entry.predicate.key;
  }

  return "wait.target";
}

function resolveText(predicate: RecordedWaitPredicate): string | undefined {
  if (predicate.kind === "text") {
    return predicate.expected;
  }

  if (predicate.kind === "resolver" && predicate.textContains) {
    return predicate.textContains;
  }

  return undefined;
}

function sanitizePreview(value: string, sensitive?: boolean): string {
  if (!value) {
    return "";
  }

  if (sensitive || isSensitiveString(value)) {
    return String(maskValue(value));
  }

  return value;
}

function sanitizeKey(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  if (SENSITIVE_KEY_PATTERN.test(value)) {
    return String(maskValue(value));
  }

  return value;
}

function isSensitiveString(value: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(value);
}

function withPredicate<T extends RecordedWaitPredicate, K extends keyof T>(predicate: RecordedWaitPredicate, key: K): T[K] | undefined {
  if (key in predicate) {
    return (predicate as T)[key];
  }

  return undefined;
}
