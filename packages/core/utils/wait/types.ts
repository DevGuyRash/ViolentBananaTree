import type { ResolveAttempt, ResolveResult } from "../../resolve";

export type WaitErrorCode =
  | "timeout"
  | "resolver-miss"
  | "idle-window-exceeded"
  | "visibility-mismatch";

export type WaitTextMatchMode = "exact" | "contains" | "regex";

export interface VisibilityOptions {
  target: "visible" | "hidden";
  requireDisplayed?: boolean;
  requireInViewport?: boolean;
  minOpacity?: number;
  minIntersectionRatio?: number;
  minBoundingBoxArea?: number;
}

export interface IdleWindowOptions {
  idleMs: number;
  maxWindowMs?: number;
  heartbeatMs?: number;
  captureStatistics?: boolean;
}

export interface WaitHint {
  scrollerKey?: string;
  presenceThreshold?: number;
  staleRetryCap?: number;
}

export interface WaitOptions {
  key?: string;
  css?: string;
  xpath?: string;
  text?: string;
  textMode?: WaitTextMatchMode;
  textPattern?: RegExp;
  visibility?: VisibilityOptions;
  idle?: IdleWindowOptions;
  timeoutMs?: number;
  intervalMs?: number;
  maxAttempts?: number;
  maxResolverRetries?: number;
  hints?: WaitHint;
  scopeKey?: string;
  scrollerKey?: string;
  presenceThreshold?: number;
  signal?: AbortSignal;
  debug?: boolean;
  telemetryMetadata?: Record<string, unknown>;
  sanitizeLogs?: boolean;
}

export interface WaitVisibilitySnapshot {
  computed: "visible" | "hidden";
  target: "visible" | "hidden";
  display?: string | null;
  visibility?: string | null;
  opacity?: number | null;
  minOpacity?: number;
  intersectionRatio?: number | null;
  minIntersectionRatio?: number;
  boundingBox?: { width: number; height: number } | null;
}

export interface WaitTextSnapshot {
  mode: WaitTextMatchMode;
  expected?: string;
  pattern?: RegExp;
  normalizedValue?: string | null;
  matches: boolean;
}

export interface WaitIdleWindowSnapshot {
  idleMs: number;
  maxWindowMs?: number;
  lastMutationAt?: number;
  mutationCount: number;
}

export interface WaitPredicateSnapshot {
  text?: WaitTextSnapshot;
  visibility?: WaitVisibilitySnapshot;
  idle?: WaitIdleWindowSnapshot;
  staleRecoveries?: number;
}

export interface WaitResult {
  key?: string;
  resolveResult: ResolveResult;
  target?: Element | null;
  attempts: ResolveAttempt[];
  pollCount: number;
  elapsedMs: number;
  strategyHistory: string[];
  staleRecoveries: number;
  predicateSnapshot?: WaitPredicateSnapshot;
  idleSnapshot?: WaitIdleWindowSnapshot;
  startedAt: number;
  finishedAt: number;
}

export interface WaitErrorBase {
  message: string;
  key?: string;
  elapsedMs: number;
  pollCount: number;
  attempts: ResolveAttempt[];
  strategyHistory: string[];
  predicateSnapshot?: WaitPredicateSnapshot;
  staleRecoveries?: number;
  cause?: unknown;
}

/**
 * Raised when a wait exhausts its timeout budget without satisfying the predicate.
 */
export interface WaitTimeoutError extends WaitErrorBase {
  code: "timeout";
  timeoutMs: number;
}

/**
 * Raised when all resolver strategies fail to locate a target element.
 */
export interface WaitResolverMissError extends WaitErrorBase {
  code: "resolver-miss";
  resolveResult: ResolveResult;
}

/**
 * Raised when the mutation idle window exceeds its maximum duration.
 */
export interface WaitIdleWindowExceededError extends WaitErrorBase {
  code: "idle-window-exceeded";
  idle: WaitIdleWindowSnapshot;
}

/**
 * Raised when a resolved element never satisfies the expected visibility state.
 */
export interface WaitVisibilityMismatchError extends WaitErrorBase {
  code: "visibility-mismatch";
  visibility: WaitVisibilitySnapshot;
}

export type WaitError =
  | WaitTimeoutError
  | WaitResolverMissError
  | WaitIdleWindowExceededError
  | WaitVisibilityMismatchError;
