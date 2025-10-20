import { debug, info, warn } from "./debug";
import type {
  SelectorEntry,
  SelectorStrategyType,
  SelectorTry
} from "../selectors/types";
import { pushHudNotification } from "../menu/hud";

export type ResolverTelemetrySource = "workflow-engine" | "recorder" | "inspector" | "resolver" | string;

export type ResolverAttemptEvent = {
  key: string;
  scopeKey?: string;
  attemptIndex: number;
  attemptCount: number;
  strategyType: SelectorStrategyType;
  success: boolean;
  elementCount: number;
  stabilityScore?: number;
  uniqueInScope?: boolean;
  tags?: string[];
  source?: ResolverTelemetrySource;
};

export type ResolverSuccessEvent = {
  key: string;
  scopeKey?: string;
  strategyType: SelectorStrategyType;
  attemptIndex: number;
  attemptCount: number;
  stabilityScore?: number;
  tags?: string[];
  source?: ResolverTelemetrySource;
};

export type ResolverMissEvent = {
  key: string;
  scopeKey?: string;
  attemptCount: number;
  tags?: string[];
  stabilityScore?: number;
  attempts: ReadonlyArray<ResolverAttemptSummary>;
  source?: ResolverTelemetrySource;
};

export type ResolverAttemptSummary = {
  attemptIndex: number;
  strategyType: SelectorStrategyType;
  success: boolean;
  elementCount: number;
  stabilityScore?: number;
  uniqueInScope?: boolean;
  tags?: string[];
};

export type ResolverTelemetryCallbacks = {
  onAttempt?: (event: ResolverAttemptEvent) => void;
  onSuccess?: (event: ResolverSuccessEvent) => void;
  onMiss?: (event: ResolverMissEvent) => void;
};

export interface ResolverTelemetry {
  logAttempt(event: ResolverAttemptEvent): void;
  logSuccess(event: ResolverSuccessEvent): void;
  logMiss(event: ResolverMissEvent): void;
}

export type ResolverTelemetryOptions = {
  source?: ResolverTelemetrySource;
  callbacks?: ResolverTelemetryCallbacks;
  hudNotifications?: boolean;
};

const DEFAULT_SOURCE: ResolverTelemetrySource = "resolver";

function scrubTags(tags?: string[]): string[] | undefined {
  if (!tags) {
    return undefined;
  }

  return tags.filter((tag) => typeof tag === "string" && tag.trim().length > 0).slice(0, 10);
}

function mergeTags(entry?: SelectorEntry, strategy?: SelectorTry): string[] | undefined {
  const merged = new Set<string>();

  scrubTags(entry?.tags)?.forEach((tag) => merged.add(tag));
  scrubTags(strategy?.tags)?.forEach((tag) => merged.add(tag));

  return merged.size > 0 ? Array.from(merged) : undefined;
}

export function summarizeAttempt(
  strategy: SelectorTry,
  index: number,
  elementCount: number
): ResolverAttemptSummary {
  return {
    attemptIndex: index,
    strategyType: strategy.type,
    success: elementCount > 0,
    elementCount,
    stabilityScore: typeof strategy.stabilityScore === "number" ? strategy.stabilityScore : undefined,
    uniqueInScope: typeof strategy.uniqueInScope === "boolean" ? strategy.uniqueInScope : undefined,
    tags: scrubTags(strategy.tags)
  };
}

function hudDescription(event: ResolverMissEvent): string {
  const attempts = event.attempts.map((attempt) => attempt.strategyType).join(" → ");
  return `Missed after ${event.attemptCount} attempts (${attempts})`;
}

function notifyHud(event: ResolverMissEvent): void {
  pushHudNotification({
    id: `resolver-miss-${event.key}-${Date.now()}`,
    title: `[DGX] Selector miss: ${event.key}`,
    description: hudDescription(event),
    level: "warn",
    metadata: {
      key: event.key,
      scopeKey: event.scopeKey,
      attemptCount: event.attemptCount,
      stabilityScore: event.stabilityScore,
      tags: event.tags,
      strategies: event.attempts.map((attempt) => ({
        index: attempt.attemptIndex,
        type: attempt.strategyType,
        stabilityScore: attempt.stabilityScore,
        uniqueInScope: attempt.uniqueInScope,
        elementCount: attempt.elementCount
      }))
    }
  });
}

function sanitizeEntry(entry?: SelectorEntry): { stabilityScore?: number; tags?: string[] } {
  return {
    stabilityScore: typeof entry?.stabilityScore === "number" ? entry?.stabilityScore : undefined,
    tags: scrubTags(entry?.tags)
  };
}

export function summarizeAttempts(
  tries: SelectorTry[],
  elementCounts: number[]
): ResolverAttemptSummary[] {
  return tries.map((strategy, index) => summarizeAttempt(strategy, index, elementCounts[index] ?? 0));
}

export function createResolverTelemetry(options: ResolverTelemetryOptions = {}): ResolverTelemetry {
  const source = options.source ?? DEFAULT_SOURCE;
  const shouldNotifyHud = options.hudNotifications !== false;

  function emitAttempt(event: ResolverAttemptEvent): void {
    debug("Resolver attempt", {
      ...event,
      tags: scrubTags(event.tags)
    });
    options.callbacks?.onAttempt?.(event);
  }

  function emitSuccess(event: ResolverSuccessEvent): void {
    info("Resolver success", {
      ...event,
      tags: scrubTags(event.tags)
    });
    options.callbacks?.onSuccess?.(event);
  }

  function emitMiss(event: ResolverMissEvent): void {
    warn("Resolver miss", {
      ...event,
      tags: scrubTags(event.tags)
    });
    options.callbacks?.onMiss?.(event);

    if (shouldNotifyHud) {
      notifyHud(event);
    }
  }

  return {
    logAttempt(event) {
      emitAttempt({ ...event, source });
    },
    logSuccess(event) {
      emitSuccess({ ...event, source });
    },
    logMiss(event) {
      emitMiss({ ...event, source });
    }
  };
}

export function buildAttemptEvent(
  key: string,
  scopeKey: string | undefined,
  attemptCount: number,
  summary: ResolverAttemptSummary,
  entry: SelectorEntry | undefined,
  strategy: SelectorTry
): ResolverAttemptEvent {
  const entryMetadata = sanitizeEntry(entry);

  return {
    key,
    scopeKey,
    attemptIndex: summary.attemptIndex,
    attemptCount,
    strategyType: summary.strategyType,
    success: summary.success,
    elementCount: summary.elementCount,
    stabilityScore: summary.stabilityScore ?? entryMetadata.stabilityScore,
    uniqueInScope: summary.uniqueInScope,
    tags: mergeTags(entry, strategy)
  };
}

export function buildSuccessEvent(
  key: string,
  scopeKey: string | undefined,
  attemptCount: number,
  summary: ResolverAttemptSummary,
  entry: SelectorEntry | undefined,
  strategy: SelectorTry
): ResolverSuccessEvent {
  const entryMetadata = sanitizeEntry(entry);

  return {
    key,
    scopeKey,
    strategyType: summary.strategyType,
    attemptIndex: summary.attemptIndex,
    attemptCount,
    stabilityScore: summary.stabilityScore ?? entryMetadata.stabilityScore,
    tags: mergeTags(entry, strategy)
  };
}

export function buildMissEvent(
  key: string,
  scopeKey: string | undefined,
  attemptSummaries: ResolverAttemptSummary[],
  entry: SelectorEntry | undefined
): ResolverMissEvent {
  const entryMetadata = sanitizeEntry(entry);

  return {
    key,
    scopeKey,
    attemptCount: attemptSummaries.length,
    stabilityScore: entryMetadata.stabilityScore,
    tags: entryMetadata.tags,
    attempts: attemptSummaries
  };
}
