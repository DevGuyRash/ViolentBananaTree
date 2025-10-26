import type { ResolveAttempt, ResolveResult } from "../../resolve";
import type { SelectorTry } from "../../../selectors/types";
import type { QueryRoot } from "../dom";
import * as coreDebug from "../../debug";
import {
  type WaitError,
  type WaitOptions,
  type WaitPredicateSnapshot,
  type WaitResult
} from "./types";

export const DEFAULT_WAIT_TIMEOUT_MS = 8000;
export const DEFAULT_WAIT_INTERVAL_MS = 150;
const DEFAULT_MAX_RESOLVER_RETRIES = 3;
const DEFAULT_JITTER_RATIO = 0.2;
const MIN_INTERVAL_MS = 25;
const HEARTBEAT_INTERVAL_MS = 1000;

export interface WaitResolverOptions {
  signal?: AbortSignal;
  scope?: QueryRoot | null;
}

export interface WaitResolver {
  resolve(key: string, options?: WaitResolverOptions): Promise<ResolveResult> | ResolveResult;
}

export interface WaitLogger {
  debug?(message: string, data?: Record<string, unknown>): void;
  info?(message: string, data?: Record<string, unknown>): void;
  warn?(message: string, data?: Record<string, unknown>): void;
  error?(message: string, data?: Record<string, unknown>): void;
}

export type WaitTelemetryEventBase = {
  key?: string;
  timeoutMs: number;
  intervalMs: number;
  metadata?: Record<string, unknown>;
};

export type WaitTelemetryStartEvent = WaitTelemetryEventBase & {
  startedAt: number;
};

export type WaitTelemetryAttemptEvent = WaitTelemetryEventBase & {
  pollCount: number;
  elapsedMs: number;
  strategyHistory: string[];
  success: boolean;
};

export type WaitTelemetryHeartbeatEvent = WaitTelemetryEventBase & {
  pollCount: number;
  elapsedMs: number;
  remainingMs: number;
  staleRecoveries: number;
  predicateSnapshot?: WaitPredicateSnapshot;
};

export type WaitTelemetrySuccessEvent = WaitTelemetryEventBase & {
  result: WaitResult;
};

export type WaitTelemetryFailureEvent = WaitTelemetryEventBase & {
  error: WaitError;
};

export interface WaitTelemetry {
  onStart?(event: WaitTelemetryStartEvent): void;
  onAttempt?(event: WaitTelemetryAttemptEvent): void;
  onHeartbeat?(event: WaitTelemetryHeartbeatEvent): void;
  onSuccess?(event: WaitTelemetrySuccessEvent): void;
  onFailure?(event: WaitTelemetryFailureEvent): void;
}

export interface WaitSchedulerClock {
  now(): number;
}

export interface WaitSchedulerDependencies {
  resolver: WaitResolver;
  logger?: WaitLogger;
  telemetry?: WaitTelemetry | null;
  clock?: WaitSchedulerClock;
  random?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface WaitPredicateContext {
  element: Element;
  resolveResult: ResolveResult;
  pollCount: number;
  elapsedMs: number;
  signal?: AbortSignal;
}

export interface WaitPredicateResult {
  satisfied: boolean;
  stale?: boolean;
  snapshot?: WaitPredicateSnapshot;
}

export type WaitPredicate = (context: WaitPredicateContext) => Promise<WaitPredicateResult> | WaitPredicateResult;

export interface WaitScheduleOptions extends WaitOptions {
  predicate?: WaitPredicate;
}

type WaitTargetResolution = {
  resolveResult: ResolveResult;
  attempts: ResolveAttempt[];
  strategyHistory: string[];
};

const defaultLogger: WaitLogger = {
  debug: coreDebug.debug,
  info: coreDebug.info,
  warn: coreDebug.warn,
  error: coreDebug.error
};

function createAbortError(signal?: AbortSignal): DOMException {
  if (signal?.reason instanceof DOMException) {
    return signal.reason;
  }

  return new DOMException("Operation aborted", "AbortError");
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    if (signal?.aborted) {
      return Promise.reject(createAbortError(signal));
    }
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError(signal));
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
      reject(createAbortError(signal));
    };

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

function computeJitteredDelay(intervalMs: number, random: () => number): number {
  const jitter = intervalMs * DEFAULT_JITTER_RATIO;

  if (jitter <= 0) {
    return intervalMs;
  }

  const min = Math.max(0, intervalMs - jitter);
  const max = intervalMs + jitter;
  return min + random() * (max - min);
}

function getRoot(scope?: QueryRoot | null): QueryRoot | null {
  if (scope) {
    return scope;
  }

  if (typeof document !== "undefined" && document) {
    return document;
  }

  return null;
}

function querySelectorAll(root: QueryRoot, selector: string): Element[] {
  try {
    return Array.from((root as ParentNode).querySelectorAll(selector));
  } catch {
    return [];
  }
}

function queryByXpath(expression: string, scope?: QueryRoot | null): Element[] {
  const root = getRoot(scope);

  if (!root) {
    return [];
  }

  const doc = root.ownerDocument ?? (root as Document);

  try {
    const snapshot = doc.evaluate(
      expression,
      root,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null
    );

    const matches: Element[] = [];

    for (let index = 0; index < snapshot.snapshotLength; index += 1) {
      const node = snapshot.snapshotItem(index);
      if (node instanceof Element) {
        matches.push(node);
      }
    }

    return matches;
  } catch {
    return [];
  }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function queryByText(
  expected: string | undefined,
  mode: WaitOptions["textMode"],
  pattern: RegExp | undefined,
  scope?: QueryRoot | null
): Element[] {
  const root = getRoot(scope);

  if (!root) {
    return [];
  }

  const matchMode = pattern ? "regex" : mode ?? "contains";
  const normalizedExpected = expected ? normalizeText(expected) : undefined;
  const nodes = Array.from((root as ParentNode).querySelectorAll("*"));

  return nodes.filter((element) => {
    const textContent = normalizeText(element.textContent ?? "");

    if (!textContent) {
      return false;
    }

    if (matchMode === "regex") {
      const regex = pattern ?? (expected ? new RegExp(expected, "i") : null);
      return regex ? regex.test(textContent) : false;
    }

    if (!normalizedExpected) {
      return false;
    }

    if (matchMode === "exact") {
      return textContent === normalizedExpected;
    }

    return textContent.includes(normalizedExpected);
  });
}

function cloneAttempts(attempts: ResolveAttempt[]): ResolveAttempt[] {
  return attempts.map((attempt) => ({
    strategy: attempt.strategy,
    success: attempt.success,
    elements: [...attempt.elements]
  }));
}

function mapStrategyHistory(attempts: ResolveAttempt[]): string[] {
  return attempts.map((attempt) => attempt.strategy.type);
}

function buildAttempt(strategy: SelectorTry, elements: Element[]): ResolveAttempt {
  return {
    strategy,
    success: elements.length > 0,
    elements
  } satisfies ResolveAttempt;
}

function mergeAttempts(base: ResolveAttempt[], extra: ResolveAttempt[]): ResolveAttempt[] {
  if (extra.length === 0) {
    return cloneAttempts(base);
  }

  return cloneAttempts([...base, ...extra]);
}

function isElementDisconnected(element: Element): boolean {
  if ("isConnected" in element) {
    return element.isConnected === false;
  }

  return false;
}

export class WaitScheduler {
  private readonly resolver: WaitResolver;
  private readonly logger: WaitLogger;
  private readonly telemetry: WaitTelemetry | null;
  private readonly clock: WaitSchedulerClock;
  private readonly random: () => number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;

  constructor(dependencies: WaitSchedulerDependencies) {
    this.resolver = dependencies.resolver;
    this.logger = dependencies.logger ?? defaultLogger;
    this.telemetry = dependencies.telemetry ?? null;
    this.clock = dependencies.clock ?? { now: () => Date.now() };
    this.random = dependencies.random ?? Math.random;
    this.sleep = dependencies.sleep ?? defaultSleep;
  }

  async waitFor(options: WaitScheduleOptions): Promise<WaitResult> {
    const startedAt = this.clock.now();
    const timeoutMs = this.resolveTimeout(options.timeoutMs);
    const intervalMs = this.resolveInterval(options.intervalMs);
    const deadline = startedAt + timeoutMs;
    const signal = options.signal;
    const maxAttempts = options.maxAttempts && options.maxAttempts > 0 ? options.maxAttempts : Number.POSITIVE_INFINITY;
    const maxResolverRetries = this.resolveRetryCap(options);

    let pollCount = 0;
    let staleRecoveries = 0;
    let lastResolverResult: ResolveResult | null = null;
    let lastPredicateSnapshot: WaitPredicateSnapshot | undefined;
    let lastHeartbeatAt = startedAt;

    const attempts: ResolveAttempt[] = [];
    const strategyHistory: string[] = [];

    this.telemetry?.onStart?.({
      key: options.key,
      timeoutMs,
      intervalMs,
      startedAt,
      metadata: options.telemetryMetadata
    });

    while (pollCount < maxAttempts) {
      if (signal?.aborted) {
        throw createAbortError(signal);
      }

      pollCount += 1;

      const now = this.clock.now();
      if (now >= deadline && pollCount > 1) {
        break;
      }

      const resolution = await this.resolveTarget(options, signal);

      lastResolverResult = resolution.resolveResult;
      attempts.push(...cloneAttempts(resolution.attempts));
      strategyHistory.push(...resolution.strategyHistory);

      const element = resolution.resolveResult.element;
      const elapsedMs = this.clock.now() - startedAt;
      const hasElement = Boolean(element);

      this.telemetry?.onAttempt?.({
        key: options.key,
        timeoutMs,
        intervalMs,
        pollCount,
        elapsedMs,
        strategyHistory: [...strategyHistory],
        success: hasElement,
        metadata: options.telemetryMetadata
      });

      if (element) {
        if (isElementDisconnected(element)) {
          staleRecoveries += 1;
          this.logger.debug?.("WaitScheduler detected stale element", {
            key: options.key,
            pollCount,
            staleRecoveries
          });

          if (staleRecoveries > maxResolverRetries) {
            const error = this.buildTimeoutError(options, {
              attempts,
              strategyHistory,
              pollCount,
              elapsedMs,
              staleRecoveries,
              timeoutMs,
              predicateSnapshot: lastPredicateSnapshot,
              message: "Exceeded stale element recovery attempts"
            });

            this.telemetry?.onFailure?.({
              key: options.key,
              timeoutMs,
              intervalMs,
              error,
              metadata: options.telemetryMetadata
            });

            throw error;
          }

          await this.delayWithRemaining(deadline, intervalMs, signal);
          continue;
        }

        if (options.predicate) {
          const predicateResult = await options.predicate({
            element,
            resolveResult: resolution.resolveResult,
            pollCount,
            elapsedMs,
            signal
          });

          if (predicateResult.snapshot) {
            lastPredicateSnapshot = predicateResult.snapshot;
          }

          if (predicateResult.stale) {
            staleRecoveries += 1;
            this.logger.debug?.("WaitScheduler predicate flagged stale target", {
              key: options.key,
              pollCount,
              staleRecoveries
            });

            if (staleRecoveries > maxResolverRetries) {
              const error = this.buildTimeoutError(options, {
                attempts,
                strategyHistory,
                pollCount,
                elapsedMs,
                staleRecoveries,
                timeoutMs,
                predicateSnapshot: lastPredicateSnapshot,
                message: "Exceeded stale predicate recovery attempts"
              });

              this.telemetry?.onFailure?.({
                key: options.key,
                timeoutMs,
                intervalMs,
                error,
                metadata: options.telemetryMetadata
              });

              throw error;
            }

            await this.delayWithRemaining(deadline, intervalMs, signal);
            continue;
          }

          if (predicateResult.satisfied) {
            const finishedAt = this.clock.now();
            const result = this.buildSuccessResult(options, resolution.resolveResult, {
              attempts,
              strategyHistory,
              pollCount,
              staleRecoveries,
              startedAt,
              finishedAt,
              predicateSnapshot: predicateResult.snapshot ?? lastPredicateSnapshot
            });

            this.telemetry?.onSuccess?.({
              key: options.key,
              timeoutMs,
              intervalMs,
              result,
              metadata: options.telemetryMetadata
            });

            return result;
          }
        } else {
          const finishedAt = this.clock.now();
          const result = this.buildSuccessResult(options, resolution.resolveResult, {
            attempts,
            strategyHistory,
            pollCount,
            staleRecoveries,
            startedAt,
            finishedAt,
            predicateSnapshot: lastPredicateSnapshot
          });

          this.telemetry?.onSuccess?.({
            key: options.key,
            timeoutMs,
            intervalMs,
            result,
            metadata: options.telemetryMetadata
          });

          return result;
        }
      }

      const heartbeatNow = this.clock.now();
      if (heartbeatNow - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
        this.telemetry?.onHeartbeat?.({
          key: options.key,
          timeoutMs,
          intervalMs,
          pollCount,
          elapsedMs,
          remainingMs: Math.max(0, deadline - heartbeatNow),
          staleRecoveries,
          predicateSnapshot: lastPredicateSnapshot,
          metadata: options.telemetryMetadata
        });
        lastHeartbeatAt = heartbeatNow;
      }

      await this.delayWithRemaining(deadline, intervalMs, signal);
    }

    const finishedAt = this.clock.now();
    const elapsedMs = finishedAt - startedAt;

    const error = lastResolverResult && lastResolverResult.element
      ? this.buildTimeoutError(options, {
          attempts,
          strategyHistory,
          pollCount,
          elapsedMs,
          staleRecoveries,
          timeoutMs,
          predicateSnapshot: lastPredicateSnapshot
        })
      : this.buildResolverMissError(options, {
          attempts,
          strategyHistory,
          pollCount,
          elapsedMs,
          staleRecoveries,
          resolveResult: lastResolverResult,
          timeoutMs
        });

    this.telemetry?.onFailure?.({
      key: options.key,
      timeoutMs,
      intervalMs,
      error,
      metadata: options.telemetryMetadata
    });

    throw error;
  }

  private resolveTimeout(timeoutMs?: number): number {
    if (typeof timeoutMs === "number" && Number.isFinite(timeoutMs)) {
      return Math.max(0, timeoutMs);
    }

    return DEFAULT_WAIT_TIMEOUT_MS;
  }

  private resolveInterval(intervalMs?: number): number {
    if (typeof intervalMs === "number" && Number.isFinite(intervalMs)) {
      return Math.max(MIN_INTERVAL_MS, intervalMs);
    }

    return DEFAULT_WAIT_INTERVAL_MS;
  }

  private resolveRetryCap(options: WaitScheduleOptions): number {
    if (typeof options.hints?.staleRetryCap === "number") {
      return Math.max(0, options.hints.staleRetryCap);
    }

    if (typeof options.maxResolverRetries === "number") {
      return Math.max(0, options.maxResolverRetries);
    }

    return DEFAULT_MAX_RESOLVER_RETRIES;
  }

  private async resolveTarget(options: WaitScheduleOptions, signal?: AbortSignal): Promise<WaitTargetResolution> {
    const scope = await this.resolveScope(options.scopeKey, signal);

    const scopeRoot = scope?.resolveResult.element ?? scope?.resolveResult.scope?.root ?? undefined;
    const attempts: ResolveAttempt[] = [];
    const strategyHistory: string[] = [];

    let resolveResult: ResolveResult | null = null;

    if (options.key) {
      resolveResult = await Promise.resolve(this.resolver.resolve(options.key, { signal, scope: scopeRoot }));
      attempts.push(...cloneAttempts(resolveResult.attempts));
      strategyHistory.push(...mapStrategyHistory(resolveResult.attempts));

      if (resolveResult.element) {
        return {
          resolveResult,
          attempts,
          strategyHistory
        };
      }
    }

    const fallback = this.resolveWithFallback(options, scopeRoot);
    attempts.push(...cloneAttempts(fallback.attempts));
    strategyHistory.push(...fallback.strategyHistory);

    if (resolveResult) {
      const mergedResult: ResolveResult = {
        key: resolveResult.key,
        element: fallback.resolveResult.element,
        attempts: mergeAttempts(resolveResult.attempts, fallback.attempts),
        resolvedBy: fallback.resolveResult.resolvedBy ?? resolveResult.resolvedBy,
        scope: resolveResult.scope ?? fallback.resolveResult.scope,
        entry: resolveResult.entry
      };

      return {
        resolveResult: mergedResult,
        attempts,
        strategyHistory
      };
    }

    return {
      resolveResult: fallback.resolveResult,
      attempts,
      strategyHistory
    };
  }

  private async resolveScope(scopeKey: string | undefined, signal?: AbortSignal): Promise<WaitTargetResolution | null> {
    if (!scopeKey) {
      return null;
    }

    const resolveResult = await Promise.resolve(this.resolver.resolve(scopeKey, { signal }));
    const attempts = cloneAttempts(resolveResult.attempts);
    const strategyHistory = mapStrategyHistory(resolveResult.attempts);

    return {
      resolveResult,
      attempts,
      strategyHistory
    } satisfies WaitTargetResolution;
  }

  private resolveWithFallback(options: WaitScheduleOptions, scope?: QueryRoot): WaitTargetResolution {
    const fallbackAttempts: ResolveAttempt[] = [];
    const strategyHistory: string[] = [];

    const resolveRoot = (): QueryRoot | null => {
      if (scope) {
        return scope;
      }
      return getRoot(null);
    };

    const candidateStrategies: Array<{
      kind: SelectorTry["type"];
      execute: () => Element[];
      buildStrategy: () => SelectorTry;
    }> = [];

    if (options.css) {
      candidateStrategies.push({
        kind: "css",
        execute: () => {
          const root = resolveRoot();
          return root ? querySelectorAll(root, options.css as string) : [];
        },
        buildStrategy: () => ({ type: "css", selector: options.css as string })
      });
    }

    if (options.xpath) {
      candidateStrategies.push({
        kind: "xpath",
        execute: () => queryByXpath(options.xpath as string, scope ?? null),
        buildStrategy: () => ({ type: "xpath", expression: options.xpath as string })
      });
    }

    if (options.text || options.textPattern) {
      candidateStrategies.push({
        kind: "text",
        execute: () => queryByText(options.text, options.textMode, options.textPattern, scope ?? null),
        buildStrategy: () => ({
          type: "text",
          text: options.text ?? options.textPattern?.source ?? "",
          exact: options.textMode === "exact",
          caseSensitive: options.textPattern ? !options.textPattern.ignoreCase : undefined,
          normalizeWhitespace: true
        })
      });
    }

    let target: Element | null = null;
    let resolvedBy: SelectorTry | undefined;

    for (const candidate of candidateStrategies) {
      const elements = candidate.execute();
      const strategy = candidate.buildStrategy();
      const attempt = buildAttempt(strategy, elements);

      fallbackAttempts.push(attempt);
      strategyHistory.push(candidate.kind);

      if (!target && attempt.success) {
        target = attempt.elements[0] ?? null;
        resolvedBy = strategy;
      }
    }

    const resolveResult: ResolveResult = {
      key: options.key ?? options.css ?? options.xpath ?? options.text ?? "wait-target",
      element: target,
      attempts: cloneAttempts(fallbackAttempts),
      resolvedBy,
      scope: scope ? { root: scope } : undefined
    };

    return {
      resolveResult,
      attempts: fallbackAttempts,
      strategyHistory
    };
  }

  private async delayWithRemaining(deadline: number, intervalMs: number, signal?: AbortSignal): Promise<void> {
    const now = this.clock.now();
    const remaining = Math.max(0, deadline - now);

    if (remaining <= 0) {
      return;
    }

    const delay = Math.min(remaining, computeJitteredDelay(intervalMs, this.random));
    if (delay <= 0) {
      return;
    }

    await this.sleep(delay, signal);
  }

  private buildSuccessResult(
    options: WaitScheduleOptions,
    resolveResult: ResolveResult,
    data: {
      attempts: ResolveAttempt[];
      strategyHistory: string[];
      pollCount: number;
      staleRecoveries: number;
      startedAt: number;
      finishedAt: number;
      predicateSnapshot?: WaitPredicateSnapshot;
    }
  ): WaitResult {
    return {
      key: options.key,
      resolveResult,
      target: resolveResult.element ?? null,
      attempts: cloneAttempts(data.attempts),
      pollCount: data.pollCount,
      elapsedMs: data.finishedAt - data.startedAt,
      strategyHistory: [...data.strategyHistory],
      staleRecoveries: data.staleRecoveries,
      predicateSnapshot: data.predicateSnapshot,
      startedAt: data.startedAt,
      finishedAt: data.finishedAt
    } satisfies WaitResult;
  }

  private buildTimeoutError(
    options: WaitScheduleOptions,
    data: {
      attempts: ResolveAttempt[];
      strategyHistory: string[];
      pollCount: number;
      elapsedMs: number;
      staleRecoveries: number;
      timeoutMs: number;
      predicateSnapshot?: WaitPredicateSnapshot;
      message?: string;
    }
  ): WaitError {
    return {
      code: "timeout",
      message: data.message ?? `Wait timed out after ${data.elapsedMs}ms`,
      key: options.key,
      elapsedMs: data.elapsedMs,
      pollCount: data.pollCount,
      attempts: cloneAttempts(data.attempts),
      strategyHistory: [...data.strategyHistory],
      predicateSnapshot: data.predicateSnapshot,
      staleRecoveries: data.staleRecoveries,
      timeoutMs: data.timeoutMs
    };
  }

  private buildResolverMissError(
    options: WaitScheduleOptions,
    data: {
      attempts: ResolveAttempt[];
      strategyHistory: string[];
      pollCount: number;
      elapsedMs: number;
      staleRecoveries: number;
      resolveResult: ResolveResult | null;
      timeoutMs: number;
    }
  ): WaitError {
    return {
      code: "resolver-miss",
      message: `Resolver failed after ${data.pollCount} polls`,
      key: options.key,
      elapsedMs: data.elapsedMs,
      pollCount: data.pollCount,
      attempts: cloneAttempts(data.attempts),
      strategyHistory: [...data.strategyHistory],
      staleRecoveries: data.staleRecoveries,
      resolveResult: data.resolveResult ?? {
        key: options.key ?? "wait-target",
        element: null,
        attempts: []
      }
    };
  }
}

export function createWaitScheduler(dependencies: WaitSchedulerDependencies): WaitScheduler {
  return new WaitScheduler(dependencies);
}
