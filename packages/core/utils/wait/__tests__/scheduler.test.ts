import test from "node:test";
import assert from "node:assert/strict";

import {
  createWaitScheduler,
  type WaitPredicate,
  type WaitResolver,
  type WaitScheduleIntegration,
  type WaitScheduler,
  type WaitTelemetryAttemptEvent,
  type WaitTelemetryFailureEvent,
  type WaitTelemetryHeartbeatEvent,
  type WaitTelemetryStartEvent,
  type WaitTelemetrySuccessEvent
} from "../scheduler";
import { createTextPredicate } from "../predicates/text";
import { createVisibilityPredicate } from "../predicates/visibility";
import type { ResolveAttempt, ResolveResult } from "../../../resolve";
import type { SelectorTry } from "../../../selectors/types";

type LoggerLevel = "debug" | "info" | "warn" | "error";

type LoggerEntry = {
  level: LoggerLevel;
  message: string;
  data?: Record<string, unknown>;
};

class FakeClock {
  private nowMs = 0;

  now(): number {
    return this.nowMs;
  }

  advance(ms: number): void {
    this.nowMs += Math.max(0, ms);
  }

  async sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw createAbortError(signal);
    }

    this.advance(ms);
  }
}

class TestElement {
  textContent: string | null;
  isConnected = true;
  scrollHeight = 0;
  clientHeight = 0;
  scrollTop = 0;
  ownerDocument: Document | null = null;

  constructor(text: string | null = null) {
    this.textContent = text;
  }

  querySelectorAll(_selector: string): Element[] {
    return [];
  }

  getBoundingClientRect(): DOMRect {
    return {
      x: 0,
      y: 0,
      width: 100,
      height: 32,
      top: 0,
      left: 0,
      right: 100,
      bottom: 32,
      toJSON() {
        return this;
      }
    } as DOMRect;
  }

  scrollTo(options: { top?: number }): void {
    if (typeof options.top === "number") {
      this.scrollTop = options.top;
    }
  }
}

type TelemetryRecorder = {
  starts: WaitTelemetryStartEvent[];
  attempts: WaitTelemetryAttemptEvent[];
  heartbeats: WaitTelemetryHeartbeatEvent[];
  successes: WaitTelemetrySuccessEvent[];
  failures: WaitTelemetryFailureEvent[];
} & ReturnType<typeof buildTelemetryHandlers>;

type TelemetryHandlers = {
  onStart(event: WaitTelemetryStartEvent): void;
  onAttempt(event: WaitTelemetryAttemptEvent): void;
  onHeartbeat(event: WaitTelemetryHeartbeatEvent): void;
  onSuccess(event: WaitTelemetrySuccessEvent): void;
  onFailure(event: WaitTelemetryFailureEvent): void;
};

function buildTelemetryHandlers(records: {
  starts: WaitTelemetryStartEvent[];
  attempts: WaitTelemetryAttemptEvent[];
  heartbeats: WaitTelemetryHeartbeatEvent[];
  successes: WaitTelemetrySuccessEvent[];
  failures: WaitTelemetryFailureEvent[];
}): TelemetryHandlers {
  return {
    onStart(event) {
      records.starts.push(event);
    },
    onAttempt(event) {
      records.attempts.push(event);
    },
    onHeartbeat(event) {
      records.heartbeats.push(event);
    },
    onSuccess(event) {
      records.successes.push(event);
    },
    onFailure(event) {
      records.failures.push(event);
    }
  } satisfies TelemetryHandlers;
}

function createTelemetryRecorder(): TelemetryRecorder {
  const records = {
    starts: [] as WaitTelemetryStartEvent[],
    attempts: [] as WaitTelemetryAttemptEvent[],
    heartbeats: [] as WaitTelemetryHeartbeatEvent[],
    successes: [] as WaitTelemetrySuccessEvent[],
    failures: [] as WaitTelemetryFailureEvent[]
  };

  return {
    ...records,
    ...buildTelemetryHandlers(records)
  } satisfies TelemetryRecorder;
}

function createAbortError(signal?: AbortSignal): DOMException {
  if (signal?.reason instanceof DOMException) {
    return signal.reason;
  }

  return new DOMException("Operation aborted", "AbortError");
}

function createTestLogger(): { logger: { [K in LoggerLevel]?: (message: string, data?: Record<string, unknown>) => void }; entries: LoggerEntry[] } {
  const entries: LoggerEntry[] = [];

  const logger = {
    debug(message: string, data?: Record<string, unknown>) {
      entries.push({ level: "debug", message, data });
    },
    info(message: string, data?: Record<string, unknown>) {
      entries.push({ level: "info", message, data });
    },
    warn(message: string, data?: Record<string, unknown>) {
      entries.push({ level: "warn", message, data });
    },
    error(message: string, data?: Record<string, unknown>) {
      entries.push({ level: "error", message, data });
    }
  } satisfies { [K in LoggerLevel]?: (message: string, data?: Record<string, unknown>) => void };

  return { logger, entries };
}

function buildAttempt(strategy: SelectorTry, success: boolean, element?: Element): ResolveAttempt {
  return {
    strategy,
    success,
    elements: success && element ? [element] : []
  } satisfies ResolveAttempt;
}

function withDomEnvironment<T>(factory: (context: { document: Document }) => Promise<T> | T): Promise<T> {
  const originalDocument = globalThis.document;
  const originalElement = globalThis.Element;
  const originalHTMLElement = globalThis.HTMLElement;
  const originalGetComputedStyle = globalThis.getComputedStyle;
  const originalInnerWidth = (globalThis as { innerWidth?: number }).innerWidth;
  const originalInnerHeight = (globalThis as { innerHeight?: number }).innerHeight;

  const fakeDocument = {
    querySelectorAll(_selector: string): Element[] {
      return [];
    },
    evaluate() {
      return {
        snapshotLength: 0,
        snapshotItem() {
          return null;
        }
      } as XPathResult;
    }
  } as unknown as Document;

  globalThis.document = fakeDocument;
  globalThis.Element = TestElement as unknown as typeof Element;
  globalThis.HTMLElement = TestElement as unknown as typeof HTMLElement;
  globalThis.getComputedStyle = ((element: Element) => {
    void element;
    return {
      display: "block",
      visibility: "visible",
      opacity: "1"
    } as CSSStyleDeclaration;
  }) as typeof getComputedStyle;

  Object.defineProperty(globalThis, "innerWidth", {
    configurable: true,
    value: 1280
  });

  Object.defineProperty(globalThis, "innerHeight", {
    configurable: true,
    value: 800
  });

  const run = async () => factory({ document: fakeDocument });

  return run()
    .finally(() => {
      globalThis.document = originalDocument;
      globalThis.Element = originalElement;
      globalThis.HTMLElement = originalHTMLElement;

      if (originalGetComputedStyle) {
        globalThis.getComputedStyle = originalGetComputedStyle;
      } else {
        // @ts-expect-error - restore undefined state when no getter existed
        delete globalThis.getComputedStyle;
      }

      if (typeof originalInnerWidth === "number") {
        Object.defineProperty(globalThis, "innerWidth", {
          configurable: true,
          value: originalInnerWidth
        });
      } else {
        delete (globalThis as { innerWidth?: number }).innerWidth;
      }

      if (typeof originalInnerHeight === "number") {
        Object.defineProperty(globalThis, "innerHeight", {
          configurable: true,
          value: originalInnerHeight
        });
      } else {
        delete (globalThis as { innerHeight?: number }).innerHeight;
      }
    });
}

function createSchedulerHarness(resolver: WaitResolver): {
  scheduler: WaitScheduler;
  clock: FakeClock;
  telemetry: TelemetryRecorder;
  loggerEntries: LoggerEntry[];
} {
  const { logger, entries } = createTestLogger();
  const telemetry = createTelemetryRecorder();
  const clock = new FakeClock();

  const scheduler = createWaitScheduler({
    resolver,
    logger,
    telemetry,
    clock,
    random: () => 0,
    sleep: (ms: number, signal?: AbortSignal) => clock.sleep(ms, signal)
  });

  return { scheduler, clock, telemetry, loggerEntries: entries };
}

test("WaitScheduler resolves fallback selectors and emits telemetry metadata", { concurrency: false }, async () => {
  await withDomEnvironment(async ({ document }) => {
    const fallbackTarget = new TestElement("Submit");
    fallbackTarget.ownerDocument = document;

    const fakeDocument = document as unknown as {
      querySelectorAll(selector: string): Element[];
    };

    fakeDocument.querySelectorAll = (selector) => {
      if (selector === ".primary") {
        return [fallbackTarget];
      }
      return [];
    };

    const resolver: WaitResolver = {
      resolve(key: string): ResolveResult {
        return {
          key,
          element: null,
          attempts: [
            buildAttempt({ type: "role", role: "button" } as SelectorTry, false)
          ]
        } satisfies ResolveResult;
      }
    };

    const { scheduler, telemetry } = createSchedulerHarness(resolver);

    const result = await scheduler.waitFor({
      key: "primaryCTA",
      css: ".primary",
      timeoutMs: 600,
      intervalMs: 100,
      telemetryMetadata: { scenario: "fallback" }
    });

    assert.equal(result.target, fallbackTarget);
    assert.equal(result.resolveResult.resolvedBy?.type, "css");
    assert.ok(result.strategyHistory.includes("css"));
    assert.equal(result.pollCount, 1);

    assert.equal(telemetry.starts.length, 1);
    assert.equal(telemetry.attempts.length, 1);
    assert.equal(telemetry.successes.length, 1);
    assert.equal(telemetry.failures.length, 0);

    const attempt = telemetry.attempts[0];
    assert.ok(attempt.strategyHistory.includes("css"));
    assert.equal(attempt.success, true);

    const success = telemetry.successes[0];
    assert.ok(success.result.strategyHistory.includes("css"));
  });
});

test("WaitScheduler satisfies text predicate after content updates and honors presence threshold", { concurrency: false }, async () => {
  await withDomEnvironment(async ({ document }) => {
    const target = new TestElement("Loading");
    target.ownerDocument = document;

    let resolveCount = 0;
    const resolver: WaitResolver = {
      resolve(key: string): ResolveResult {
        resolveCount += 1;
        if (resolveCount >= 2) {
          target.textContent = "Ready";
        }

        return {
          key,
          element: target,
          attempts: [
            buildAttempt({ type: "css", selector: "#status" } as SelectorTry, true, target)
          ],
          resolvedBy: { type: "css", selector: "#status" } as SelectorTry
        } satisfies ResolveResult;
      }
    };

    const predicate = createTextPredicate({
      expected: "Ready",
      mode: "exact",
      sanitize: true
    });

    const { scheduler, telemetry } = createSchedulerHarness(resolver);

    const result = await scheduler.waitFor({
      key: "status",
      intervalMs: 100,
      timeoutMs: 1200,
      presenceThreshold: 2,
      predicate
    });

    assert.equal(result.target, target);
    assert.equal(result.pollCount, 3);
    assert.equal(result.staleRecoveries, 0);
    assert.equal(result.predicateSnapshot?.text?.matches, true);
    assert.equal(result.predicateSnapshot?.text?.expected, "[***masked***]");

    assert.equal(telemetry.successes.length, 1);
    const success = telemetry.successes[0];
    assert.equal(success.result.predicateSnapshot?.text?.matches, true);
    assert.ok(success.result.strategyHistory.includes("css"));
  });
});

test("WaitScheduler surfaces idle snapshot after mutation bursts and emits heartbeat telemetry", { concurrency: false }, async () => {
  await withDomEnvironment(async ({ document }) => {
    const target = new TestElement("Idle target");
    target.ownerDocument = document;

    const resolver: WaitResolver = {
      resolve(key: string): ResolveResult {
        return {
          key,
          element: target,
          attempts: [
            buildAttempt({ type: "css", selector: "#pane" } as SelectorTry, true, target)
          ],
          resolvedBy: { type: "css", selector: "#pane" } as SelectorTry
        } satisfies ResolveResult;
      }
    };

    let mutationCount = 0;
    const predicate: WaitPredicate = ({ elapsedMs }) => {
      mutationCount += 1;
      const settle = elapsedMs >= 1600;

      return {
        satisfied: settle,
        stale: false,
        snapshot: {
          idle: {
            idleMs: 200,
            mutationCount,
            lastMutationAt: settle ? elapsedMs - 200 : elapsedMs,
            maxWindowMs: 1500
          }
        }
      };
    };

    const { scheduler, telemetry, clock } = createSchedulerHarness(resolver);

    const result = await scheduler.waitFor({
      key: "idle-pane",
      intervalMs: 400,
      timeoutMs: 3000,
      predicate,
      presenceThreshold: 2
    });

    assert.equal(result.predicateSnapshot?.idle?.idleMs, 200);
    assert.equal(result.predicateSnapshot?.idle?.mutationCount, mutationCount);
    assert.ok(result.elapsedMs >= 1600);

    assert.ok(telemetry.heartbeats.length >= 1);
    const heartbeat = telemetry.heartbeats[0];
    assert.ok(heartbeat.predicateSnapshot?.idle);
    assert.ok(heartbeat.elapsedMs >= 1000);
    assert.ok(clock.now() >= result.elapsedMs);
  });
});

test("WaitScheduler enforces timeout on resolver miss and preserves failure metadata", { concurrency: false }, async () => {
  await withDomEnvironment(async () => {
    let polls = 0;
    const resolver: WaitResolver = {
      resolve(key: string): ResolveResult {
        polls += 1;
        return {
          key,
          element: null,
          attempts: [
            buildAttempt({ type: "role", role: "status" } as SelectorTry, false)
          ]
        } satisfies ResolveResult;
      }
    };

    const { scheduler, telemetry } = createSchedulerHarness(resolver);

    await assert.rejects(async () => {
      await scheduler.waitFor({
        key: "missing",
        timeoutMs: 900,
        intervalMs: 200
      });
    }, (error: unknown) => {
      const waitError = error as { code?: string; pollCount?: number; attempts?: ResolveAttempt[] };
      assert.equal(waitError.code, "resolver-miss");
      assert.ok((waitError.pollCount ?? 0) >= 1);
      assert.ok(Array.isArray(waitError.attempts));
      return true;
    });

    assert.ok(polls >= 4);
    assert.equal(telemetry.failures.length, 1);
    const failure = telemetry.failures[0];
    assert.equal(failure.error.code, "resolver-miss");
    assert.ok(failure.error.pollCount >= 1);
    assert.ok(failure.error.strategyHistory.includes("role"));
  });
});

test("WaitScheduler recovers from stale nodes within retry cap", { concurrency: false }, async () => {
  await withDomEnvironment(async ({ document }) => {
    const stale = new TestElement("Row");
    stale.ownerDocument = document;
    stale.isConnected = false;

    const fresh = new TestElement("Row");
    fresh.ownerDocument = document;

    let polls = 0;
    const resolver: WaitResolver = {
      resolve(key: string): ResolveResult {
        polls += 1;
        if (polls === 1) {
          return {
            key,
            element: stale,
            attempts: [
              buildAttempt({ type: "css", selector: ".row" } as SelectorTry, true, stale)
            ],
            resolvedBy: { type: "css", selector: ".row" } as SelectorTry
          } satisfies ResolveResult;
        }

        return {
          key,
          element: fresh,
          attempts: [
            buildAttempt({ type: "css", selector: ".row" } as SelectorTry, true, fresh)
          ],
          resolvedBy: { type: "css", selector: ".row" } as SelectorTry
        } satisfies ResolveResult;
      }
    };

    const { scheduler, telemetry, loggerEntries } = createSchedulerHarness(resolver);

    const result = await scheduler.waitFor({
      key: "virtualRow",
      timeoutMs: 2000,
      intervalMs: 150
    });

    assert.equal(result.target, fresh);
    assert.ok(result.staleRecoveries >= 1);
    assert.equal(result.pollCount, 2);
    assert.ok(telemetry.successes[0]?.result.staleRecoveries >= 1);

    const staleLog = loggerEntries.find((entry) => entry.message.includes("stale element"));
    assert.ok(staleLog, "stale element debug log expected");
  });
});

test("WaitScheduler aborts when stale recoveries exceed retry cap", { concurrency: false }, async () => {
  await withDomEnvironment(async ({ document }) => {
    const stale = new TestElement("Detached");
    stale.ownerDocument = document;
    stale.isConnected = false;

    let polls = 0;
    const resolver: WaitResolver = {
      resolve(key: string): ResolveResult {
        polls += 1;
        return {
          key,
          element: stale,
          attempts: [
            buildAttempt({ type: "css", selector: ".detached" } as SelectorTry, true, stale)
          ],
          resolvedBy: { type: "css", selector: ".detached" } as SelectorTry
        } satisfies ResolveResult;
      }
    };

    const { scheduler, telemetry } = createSchedulerHarness(resolver);

    await assert.rejects(async () => {
      await scheduler.waitFor({
        key: "detached",
        timeoutMs: 800,
        intervalMs: 100,
        maxResolverRetries: 1
      });
    }, (error: unknown) => {
      const waitError = error as { code?: string; message?: string; staleRecoveries?: number };
      assert.equal(waitError.code, "timeout");
      assert.ok((waitError.staleRecoveries ?? 0) > 1);
      assert.ok(waitError.message?.includes("stale"));
      return true;
    });

    assert.equal(telemetry.failures.length, 1);
    const failure = telemetry.failures[0];
    assert.equal(failure.error.code, "timeout");
    assert.ok((failure.error.staleRecoveries ?? 0) > 1);
  });
});

test("WaitScheduler cooperates with schedule integrations that require retries", { concurrency: false }, async () => {
  await withDomEnvironment(async ({ document }) => {
    const target = new TestElement("Dynamic");
    target.ownerDocument = document;

    let polls = 0;
    const resolver: WaitResolver = {
      resolve(key: string): ResolveResult {
        polls += 1;
        if (polls >= 3) {
          return {
            key,
            element: target,
            attempts: [
              buildAttempt({ type: "css", selector: ".item" } as SelectorTry, true, target)
            ],
            resolvedBy: { type: "css", selector: ".item" } as SelectorTry
          } satisfies ResolveResult;
        }

        return {
          key,
          element: null,
          attempts: [
            buildAttempt({ type: "css", selector: ".item" } as SelectorTry, false)
          ]
        } satisfies ResolveResult;
      }
    };

    let retries = 0;
    const integration: WaitScheduleIntegration = {
      async afterResolve(context) {
        if (!context.resolution.resolveResult.element && retries < 2) {
          retries += 1;
          return "retry";
        }
        return "continue";
      }
    } satisfies WaitScheduleIntegration;

    const { scheduler, telemetry } = createSchedulerHarness(resolver);

    const result = await scheduler.waitFor({
      key: "dynamic-item",
      intervalMs: 200,
      timeoutMs: 2000,
      integration
    });

    assert.equal(result.target, target);
    assert.equal(retries, 2);
    assert.equal(result.pollCount, 3);
    assert.equal(telemetry.attempts.length, 1);
    assert.equal(telemetry.successes.length, 1);
    assert.equal(telemetry.attempts[0]?.pollCount, 3);
  });
});

test("WaitScheduler integrates visibility predicate snapshots", { concurrency: false }, async () => {
  await withDomEnvironment(async ({ document }) => {
    let visibilityState: "hidden" | "visible" = "hidden";

    globalThis.getComputedStyle = ((element: Element) => {
      void element;
      return {
        display: visibilityState === "hidden" ? "none" : "block",
        visibility: visibilityState,
        opacity: visibilityState === "hidden" ? "0" : "1"
      } as CSSStyleDeclaration;
    }) as typeof getComputedStyle;

    const target = new TestElement("Panel");
    target.ownerDocument = document;

    let polls = 0;
    const resolver: WaitResolver = {
      resolve(key: string): ResolveResult {
        polls += 1;
        if (polls >= 2) {
          visibilityState = "visible";
        }

        return {
          key,
          element: target,
          attempts: [
            buildAttempt({ type: "css", selector: "#panel" } as SelectorTry, true, target)
          ],
          resolvedBy: { type: "css", selector: "#panel" } as SelectorTry
        } satisfies ResolveResult;
      }
    };

    const predicate = createVisibilityPredicate({
      target: "visible",
      requireDisplayed: true,
      minOpacity: 0.5
    });

    const { scheduler, telemetry } = createSchedulerHarness(resolver);

    const result = await scheduler.waitFor({
      key: "panel",
      intervalMs: 120,
      timeoutMs: 1500,
      predicate
    });

    assert.equal(result.target, target);
    assert.equal(result.pollCount, 2);
    assert.equal(result.predicateSnapshot?.visibility?.target, "visible");
    assert.equal(result.predicateSnapshot?.visibility?.computed, "visible");
    assert.ok(telemetry.successes[0]?.result.predicateSnapshot?.visibility);
  });
});
