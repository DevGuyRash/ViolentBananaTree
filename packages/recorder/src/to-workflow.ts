import { maskValue, SENSITIVE_KEY_PATTERN } from "../../workflows/src/actions/shared";
import {
  DEFAULT_WAIT_INTERVAL_MS,
  DEFAULT_WAIT_TIMEOUT_MS
} from "../../core/utils/wait";
import type { WaitActionKind } from "../../workflows/src/actions/wait";
import type {
  WaitForIdleStep,
  WaitForStep,
  WaitHiddenStep,
  WaitTextStep,
  WaitVisibleStep,
  WorkflowStep
} from "../../workflows/src/types";

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

export interface RecorderWorkflowExportInputStep {
  kind: "wait" | "passthrough";
  wait?: RecordedWaitExport;
  step?: WorkflowStep;
}

export interface RecorderWorkflowExportResult {
  steps: WorkflowStep[];
  waitAnnotations: WaitAnnotations[];
}

export function exportRecorderWorkflowSteps(steps: RecorderWorkflowExportInputStep[]): RecorderWorkflowExportResult {
  const exported: WorkflowStep[] = [];
  const annotations: WaitAnnotations[] = [];

  steps.forEach((entry) => {
    if (entry.kind === "wait" && entry.wait) {
      const wait = buildWaitStep(entry.wait);
      exported.push(wait.step);
      annotations.push(wait.annotations);
      return;
    }

    if (entry.step) {
      exported.push(entry.step);
    }
  });

  return {
    steps: exported,
    waitAnnotations: annotations
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
