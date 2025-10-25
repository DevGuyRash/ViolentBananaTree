import type { WaitSchedulerClock } from "./scheduler";
import type { IdleWindowOptions, WaitIdleWindowSnapshot } from "./types";

export interface MutationIdleGateDependencies {
  clock?: WaitSchedulerClock;
  createObserver?: (callback: MutationCallback) => MutationObserver | null;
}

export interface MutationIdleGateHeartbeatEvent {
  snapshot: WaitIdleWindowSnapshot;
  startedAt: number;
  timestamp: number;
  elapsedMs: number;
  idleRemainingMs: number;
  windowRemainingMs?: number;
}

export interface MutationIdleGateTelemetry {
  onHeartbeat?(event: MutationIdleGateHeartbeatEvent): void;
}

export interface MutationIdleGateStatistics {
  totalMutations: number;
  attributes: number;
  childList: number;
  characterData: number;
  attributeNames?: Record<string, number>;
  targetNodeNames?: Record<string, number>;
}

export interface MutationIdleGateResult {
  snapshot: WaitIdleWindowSnapshot;
  statistics: MutationIdleGateStatistics;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
}

export interface MutationIdleGateOptions {
  root?: Node | Document | DocumentFragment | ShadowRoot | Element | null;
  targets?: Array<Node | Element | null | undefined> | Node | Element | null;
  observe?: MutationObserverInit;
  signal?: AbortSignal;
  telemetry?: MutationIdleGateTelemetry | null;
}

export interface MutationIdleGateWaitOptions extends MutationIdleGateOptions {
  idle: IdleWindowOptions;
}

export class MutationIdleWindowExceededError extends Error {
  readonly code = "idle-window-exceeded" as const;
  readonly snapshot: WaitIdleWindowSnapshot;
  readonly durationMs: number;
  readonly statistics: MutationIdleGateStatistics;

  constructor(message: string, snapshot: WaitIdleWindowSnapshot, durationMs: number, statistics: MutationIdleGateStatistics) {
    super(message);
    this.name = "MutationIdleWindowExceededError";
    this.snapshot = snapshot;
    this.durationMs = durationMs;
    this.statistics = statistics;
  }
}

const DEFAULT_OBSERVER_CONFIG: MutationObserverInit = {
  attributes: true,
  childList: true,
  characterData: true,
  subtree: true
};

const DEFAULT_HEARTBEAT_MS = 1000;
const DETAIL_CAP = 20;

export function createMutationIdleGate(dependencies: MutationIdleGateDependencies = {}) {
  const clock: WaitSchedulerClock = dependencies.clock ?? { now: () => Date.now() };
  const buildObserver = dependencies.createObserver ?? ((callback: MutationCallback) => {
    if (typeof MutationObserver !== "function") {
      return null;
    }
    return new MutationObserver(callback);
  });

  const now = (): number => clock.now();

  const resolveRoot = (
    root?: Node | Document | DocumentFragment | ShadowRoot | Element | null
  ): Node | Document | DocumentFragment | ShadowRoot | Element => {
    if (root) {
      return root;
    }

    if (typeof document !== "undefined" && document) {
      return document;
    }

    throw new Error("Mutation idle gate requires a root node or document to observe");
  };

  const createAbortError = (signal?: AbortSignal): DOMException => {
    if (signal?.reason instanceof DOMException) {
      return signal.reason;
    }

    return new DOMException("Operation aborted", "AbortError");
  };

  const toArray = <T>(value: T | T[] | null | undefined): T[] => {
    if (Array.isArray(value)) {
      return value.filter((item): item is T => Boolean(item));
    }
    if (!value) {
      return [];
    }
    return [value];
  };

  const incrementDetail = (map: Map<string, number> | null, key: string): void => {
    if (!map) {
      return;
    }

    if (!map.has(key) && map.size >= DETAIL_CAP) {
      return;
    }

    map.set(key, (map.get(key) ?? 0) + 1);
  };

  const mapToRecord = (map: Map<string, number> | null): Record<string, number> | undefined => {
    if (!map || map.size === 0) {
      return undefined;
    }

    const entries = Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
    const limited = entries.slice(0, DETAIL_CAP);

    return limited.reduce<Record<string, number>>((accumulator, [key, value]) => {
      accumulator[key] = value;
      return accumulator;
    }, {});
  };

  const buildStatistics = (
    totals: { attributes: number; childList: number; characterData: number; total: number },
    attributeNames: Map<string, number> | null,
    targetNodeNames: Map<string, number> | null
  ): MutationIdleGateStatistics => ({
    totalMutations: totals.total,
    attributes: totals.attributes,
    childList: totals.childList,
    characterData: totals.characterData,
    attributeNames: mapToRecord(attributeNames),
    targetNodeNames: mapToRecord(targetNodeNames)
  });

  async function waitForIdle(options: MutationIdleGateWaitOptions): Promise<MutationIdleGateResult> {
    const { idle } = options;

    if (!idle || typeof idle.idleMs !== "number" || idle.idleMs < 0) {
      throw new Error("Mutation idle gate requires a non-negative idleMs value");
    }

    const idleMs = Math.max(0, idle.idleMs);
    const maxWindowMs = typeof idle.maxWindowMs === "number" && Number.isFinite(idle.maxWindowMs)
      ? Math.max(0, idle.maxWindowMs)
      : undefined;
    const heartbeatMs = typeof idle.heartbeatMs === "number" && Number.isFinite(idle.heartbeatMs)
      ? Math.max(0, idle.heartbeatMs)
      : DEFAULT_HEARTBEAT_MS;

    if (options.signal?.aborted) {
      throw createAbortError(options.signal);
    }

    const startedAt = now();

    if (idleMs === 0) {
      const snapshot: WaitIdleWindowSnapshot = {
        idleMs,
        maxWindowMs,
        lastMutationAt: undefined,
        mutationCount: 0
      };

      return {
        snapshot,
        statistics: {
          totalMutations: 0,
          attributes: 0,
          childList: 0,
          characterData: 0
        },
        startedAt,
        finishedAt: startedAt,
        durationMs: 0
      } satisfies MutationIdleGateResult;
    }

    const totals = {
      attributes: 0,
      childList: 0,
      characterData: 0,
      total: 0
    };

    const collectDetails = idle.captureStatistics === true;
    const attributeNames = collectDetails ? new Map<string, number>() : null;
    const targetNodeNames = collectDetails ? new Map<string, number>() : null;

    return await new Promise<MutationIdleGateResult>((resolvePromise, rejectPromise) => {
      let settled = false;
      let lastMutationAt = startedAt;
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      let maxTimer: ReturnType<typeof setTimeout> | undefined;
      let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;

      const observer = buildObserver((records) => {
        if (!records || records.length === 0) {
          return;
        }

        const observedAt = now();
        lastMutationAt = observedAt;

        for (const record of records) {
          totals.total += 1;

          if (record.type === "attributes") {
            totals.attributes += 1;
            if (record.attributeName) {
              incrementDetail(attributeNames, record.attributeName);
            }
          } else if (record.type === "characterData") {
            totals.characterData += 1;
          } else if (record.type === "childList") {
            totals.childList += 1;
          }

          if (collectDetails) {
            const target = record.target;
            const label = target && "nodeName" in target
              ? String(target.nodeName ?? "#unknown").toLowerCase()
              : "#unknown";
            incrementDetail(targetNodeNames, label);
          }
        }

        restartIdleTimer();
        emitHeartbeat(observedAt);
      });

      const cleanup = () => {
        observer?.disconnect();
        if (idleTimer) {
          clearTimeout(idleTimer);
          idleTimer = undefined;
        }
        if (heartbeatTimer) {
          clearTimeout(heartbeatTimer);
          heartbeatTimer = undefined;
        }
        if (maxTimer) {
          clearTimeout(maxTimer);
          maxTimer = undefined;
        }
        if (options.signal) {
          options.signal.removeEventListener("abort", onAbort);
        }
      };

      const buildSnapshot = (timestamp: number): WaitIdleWindowSnapshot => ({
        idleMs,
        maxWindowMs,
        lastMutationAt,
        mutationCount: totals.total
      });

      const buildResult = (finishedAt: number): MutationIdleGateResult => ({
        snapshot: buildSnapshot(finishedAt),
        statistics: buildStatistics(totals, attributeNames, targetNodeNames),
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt
      });

      const finishSuccess = () => {
        if (settled) {
          return;
        }
        settled = true;
        const finishedAt = now();
        const result = buildResult(finishedAt);
        cleanup();
        resolvePromise(result);
      };

      const finishError = (error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        rejectPromise(error);
      };

      const onAbort = () => {
        finishError(createAbortError(options.signal));
      };

      const emitHeartbeat = (timestamp: number = now()) => {
        if (!options.telemetry?.onHeartbeat) {
          return;
        }

        const reference = lastMutationAt;
        const idleRemaining = Math.max(0, idleMs - (timestamp - reference));
        const windowRemaining = typeof maxWindowMs === "number"
          ? Math.max(0, (startedAt + maxWindowMs) - timestamp)
          : undefined;

        options.telemetry.onHeartbeat({
          snapshot: buildSnapshot(timestamp),
          startedAt,
          timestamp,
          elapsedMs: timestamp - startedAt,
          idleRemainingMs: idleRemaining,
          windowRemainingMs: windowRemaining
        });
      };

      const queueHeartbeat = () => {
        if (!options.telemetry?.onHeartbeat) {
          return;
        }

        emitHeartbeat();

        if (heartbeatMs === 0) {
          return;
        }

        heartbeatTimer = setTimeout(() => {
          emitHeartbeat();
          queueHeartbeat();
        }, heartbeatMs);
      };

      const restartIdleTimer = () => {
        if (idleTimer) {
          clearTimeout(idleTimer);
        }

        const reference = lastMutationAt;
        const remaining = Math.max(0, idleMs - (now() - reference));

        if (remaining === 0) {
          finishSuccess();
          return;
        }

        idleTimer = setTimeout(() => {
          const elapsed = now() - lastMutationAt;
          if (elapsed >= idleMs) {
            finishSuccess();
            return;
          }
          restartIdleTimer();
        }, remaining);
      };

      const scheduleMaxWindow = () => {
        if (typeof maxWindowMs !== "number") {
          return;
        }

        if (maxWindowMs === 0) {
          const result = buildResult(now());
          finishError(new MutationIdleWindowExceededError(
            "Idle window exceeded before reaching the idle threshold",
            result.snapshot,
            result.durationMs,
            result.statistics
          ));
          return;
        }

        maxTimer = setTimeout(() => {
          const result = buildResult(now());
          finishError(new MutationIdleWindowExceededError(
            `Idle window exceeded after ${result.durationMs}ms with ${result.snapshot.mutationCount} mutations`,
            result.snapshot,
            result.durationMs,
            result.statistics
          ));
        }, maxWindowMs);
      };

      try {
        if (options.signal) {
          options.signal.addEventListener("abort", onAbort, { once: true });
        }

        if (observer) {
          const targets = toArray(options.targets);
          if (targets.length > 0) {
            for (const target of targets) {
              observer.observe(target, options.observe ?? DEFAULT_OBSERVER_CONFIG);
            }
          } else {
            const root = resolveRoot(options.root ?? null);
            observer.observe(root, options.observe ?? DEFAULT_OBSERVER_CONFIG);
          }
        }

        restartIdleTimer();
        scheduleMaxWindow();
        queueHeartbeat();
      } catch (error) {
        finishError(error);
        return;
      }

      if (!observer) {
        // No mutation observer available; rely solely on the idle timer and max window.
        emitHeartbeat();
      }
    });
  }

  return {
    waitForIdle
  };
}
