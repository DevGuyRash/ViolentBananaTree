import test from "node:test";
import assert from "node:assert/strict";

import {
  createWaitHelpers,
  createWaitTelemetryAdapter
} from "../index";
import type {
  WaitHelpers,
  WaitHelpersDependencies,
  WaitSchedulerClock,
  WaitSchedulerDependencies,
  WaitResolver,
  WaitTelemetryEventEnvelope
} from "../index";
import type {
  ResolveAttempt,
  ResolveResult
} from "../../../resolve";
import type { SelectorTry } from "../../../selectors/types";

type LoggerEntry = {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  data?: Record<string, unknown>;
};

class FakeClock implements WaitSchedulerClock {
  private nowMs = 0;

  now(): number {
    return this.nowMs;
  }

  advance(ms: number): void {
    this.nowMs += Math.max(0, ms);
  }

  async sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw new DOMException("Operation aborted", "AbortError");
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

  constructor(textContent: string | null = null) {
    this.textContent = textContent;
  }

  querySelectorAll(_selector: string): Element[] {
    return [];
  }

  getBoundingClientRect(): DOMRect {
    return {
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      top: 0,
      left: 0,
      right: 100,
      bottom: 40,
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

async function withDomEnvironment<T>(factory: () => T | Promise<T>): Promise<T> {
  const originalDocument = globalThis.document;
  const originalElement = globalThis.Element;
  const originalHTMLElement = globalThis.HTMLElement;
  const originalGetComputedStyle = globalThis.getComputedStyle;
  const originalInnerWidth = globalThis.innerWidth;
  const originalInnerHeight = globalThis.innerHeight;

  const fakeDocument = {
    querySelectorAll(_selector: string): Element[] {
      return [];
    }
  } as unknown as Document;

  globalThis.document = fakeDocument;
  globalThis.Element = TestElement as unknown as typeof Element;
  globalThis.HTMLElement = TestElement as unknown as typeof HTMLElement;
  globalThis.getComputedStyle = (() => ({
    display: "block",
    visibility: "visible",
    opacity: "1"
  })) as typeof getComputedStyle;
  Object.defineProperty(globalThis, "innerWidth", {
    configurable: true,
    value: 1024
  });
  Object.defineProperty(globalThis, "innerHeight", {
    configurable: true,
    value: 768
  });

  try {
    const output = await factory();
    return output;
  } finally {
    globalThis.document = originalDocument;
    globalThis.Element = originalElement;
    globalThis.HTMLElement = originalHTMLElement;
    if (originalGetComputedStyle) {
      globalThis.getComputedStyle = originalGetComputedStyle;
    } else {
      // @ts-expect-error - restoring undefined when not present originally
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
  }
}

function createTestLogger() {
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
  } satisfies NonNullable<WaitSchedulerDependencies["logger"]>;

  return { logger, entries };
}

function buildAttempt(strategy: SelectorTry, success: boolean, element?: Element): ResolveAttempt {
  return {
    strategy,
    success,
    elements: success && element ? [element] : []
  } satisfies ResolveAttempt;
}

function createResolver(scenarios: Record<string, () => ResolveResult>): WaitResolver {
  return {
    resolve(key: string): ResolveResult {
      const factory = scenarios[key];
      if (!factory) {
        return {
          key,
          element: null,
          attempts: []
        } satisfies ResolveResult;
      }
      return factory();
    }
  } satisfies WaitResolver;
}

function createWaitHelpersHarness(overrides: Partial<WaitHelpersDependencies> & {
  resolver: WaitResolver;
}): {
  helpers: WaitHelpers;
  clock: FakeClock;
  telemetryEvents: WaitTelemetryEventEnvelope[];
  loggerEntries: LoggerEntry[];
} {
  const clock = new FakeClock();
  const { logger, entries } = createTestLogger();
  const telemetryRecords: WaitTelemetryEventEnvelope[] = [];

  const telemetry = createWaitTelemetryAdapter({
    debug: true,
    logger,
    notify(event) {
      telemetryRecords.push(event);
    }
  });

  const helpers = createWaitHelpers({
    resolver: overrides.resolver,
    logger,
    telemetry,
    clock,
    random: () => 0,
    sleep: (ms: number, signal?: AbortSignal) => clock.sleep(ms, signal),
    ...overrides
  });

  return {
    helpers,
    clock,
    telemetryEvents: telemetryRecords,
    loggerEntries: entries
  };
}

function getTelemetryPayloads<T = Record<string, unknown>>(
  events: WaitTelemetryEventEnvelope[],
  kind: WaitTelemetryEventEnvelope["kind"]
): T[] {
  return events
    .filter((event) => event.kind === kind)
    .map((event) => event.payload as T);
}

test("waitFor merges resolver strategies with fallback selectors", { concurrency: false }, async () => {
  await withDomEnvironment(async () => {
    const fallbackTarget = new TestElement("Submit");
    fallbackTarget.ownerDocument = globalThis.document;

    const fakeDocument = globalThis.document as unknown as {
      querySelectorAll(selector: string): Element[];
    };

    fakeDocument.querySelectorAll = (selector) => {
      if (selector === ".primary") {
        return [fallbackTarget];
      }
      return [];
    };

    const probe = fakeDocument.querySelectorAll(".primary");
    assert.equal(probe.length, 1, "Document fallback should resolve css selector");

    const resolver = createResolver({
      primary: () => ({
        key: "primary",
        element: null,
        attempts: [
          buildAttempt({ type: "role", role: "button" }, false),
          buildAttempt({ type: "dataAttr", key: "data-testid", value: "submit" }, false)
        ]
      })
    });

    const { helpers, telemetryEvents, loggerEntries } = createWaitHelpersHarness({ resolver });

    const result = await helpers.waitFor({
      key: "primary",
      css: ".primary",
      timeoutMs: 600,
      debug: true
    });

    assert.ok(result.target === fallbackTarget, "fallback CSS selector should resolve element");
    assert.equal(result.resolveResult.resolvedBy?.type, "css");
    assert.ok(result.strategyHistory.includes("css"), "strategy history should record css fallback");
    assert.equal(result.pollCount, 1);

    const successEvents = getTelemetryPayloads(telemetryEvents, "success");
    assert.ok(successEvents.length >= 1, "success telemetry should be recorded");
    const successPayload = successEvents.at(-1);
    assert.ok(successPayload);
    assert.ok(Array.isArray(successPayload!.strategyHistory));
    assert.ok((successPayload!.strategyHistory as unknown[]).includes("css"));

    const startLog = loggerEntries.find((entry) => entry.level === "debug" && entry.message === "wait:start");
    assert.ok(startLog, "wait start should be logged when debug true");
    assert.equal(startLog!.data?.key, "[***masked***]", "keys should be sanitized in debug logs");
  });
});

test("waitText polls until predicate matches and captures sanitized snapshots", { concurrency: false }, async () => {
  await withDomEnvironment(async () => {
    const target = new TestElement("Loading");

    let pollCount = 0;

    const resolver: WaitResolver = {
      resolve(): ResolveResult {
        pollCount += 1;
        if (pollCount >= 2) {
          target.textContent = "Ready";
        }

        return {
          key: "status",
          element: target,
          attempts: [
            buildAttempt({ type: "role", role: "status" }, true, target)
          ],
          resolvedBy: { type: "role", role: "status" }
        } satisfies ResolveResult;
      }
    };

    const { helpers, telemetryEvents } = createWaitHelpersHarness({ resolver });

    const result = await helpers.waitText({
      key: "status",
      text: "Ready",
      timeoutMs: 1200,
      intervalMs: 150,
      debug: true
    });

    assert.equal(result.target, target);
    assert.ok(result.pollCount >= 2, "should poll until text matches");
    assert.equal(result.predicateSnapshot?.text?.expected, "[***masked***]", "snapshots should sanitize expected text");
    assert.equal(result.predicateSnapshot?.text?.matches, true);

    const attemptEvents = getTelemetryPayloads(telemetryEvents, "attempt");
    assert.ok(attemptEvents.length >= 2, "telemetry attempts should capture each poll");
    const successPayloads = getTelemetryPayloads(telemetryEvents, "success");
    assert.equal(successPayloads.length, 1, "single success event expected");
    const successSnapshot = successPayloads[0]?.predicateSnapshot as { text?: { matches?: boolean } } | undefined;
    assert.equal(successSnapshot?.text?.matches, true);
  });
});

test("waitVisible defers idle gate until visibility satisfied and reports mutation snapshots", { concurrency: false }, async () => {
  await withDomEnvironment(async () => {
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
    const idleSnapshot = {
      idleMs: 200,
      mutationCount: 0
    };

    let waitForIdleInvocations = 0;
    const idleGate = {
      waitForIdle: async () => {
        waitForIdleInvocations += 1;
        return {
          snapshot: idleSnapshot,
          statistics: {
            totalMutations: 3,
            attributes: 1,
            childList: 2,
            characterData: 0
          },
          startedAt: 0,
          finishedAt: 200,
          durationMs: 200
        };
      }
    };

    let polls = 0;
    const resolver: WaitResolver = {
      resolve(): ResolveResult {
        polls += 1;
        if (polls >= 2) {
          visibilityState = "visible";
        }

        return {
          key: "panel",
          element: target,
          attempts: [
            buildAttempt({ type: "css", selector: "#panel" }, true, target)
          ],
          resolvedBy: { type: "css", selector: "#panel" }
        } satisfies ResolveResult;
      }
    };

    const { helpers } = createWaitHelpersHarness({
      resolver,
      idleGate,
      idleGateTelemetry: {
        onHeartbeat(event) {
          assert.equal(event.snapshot.mutationCount, 0, "heartbeat snapshot should propagate");
        }
      }
    } as Partial<WaitHelpersDependencies> & { resolver: WaitResolver; idleGate: typeof idleGate });

    const result = await helpers.waitVisible({
      key: "panel",
      idle: { idleMs: 200, heartbeatMs: 50 },
      timeoutMs: 2000,
      debug: true
    });

    assert.equal(waitForIdleInvocations, 1, "idle gate should run after visibility satisfied");
    assert.equal(result.idleSnapshot?.idleMs, 200);
    assert.equal(result.predicateSnapshot?.visibility?.computed, "visible");
  });
});

test("waitFor enforces timeout, logs sanitized metadata, and records failure telemetry", { concurrency: false }, async () => {
  await withDomEnvironment(async () => {
    const resolver: WaitResolver = {
      resolve(): ResolveResult {
        return {
          key: "missing",
          element: null,
          attempts: [
            buildAttempt({ type: "role", role: "button" }, false)
          ]
        } satisfies ResolveResult;
      }
    };

    const { helpers, telemetryEvents, loggerEntries, clock } = createWaitHelpersHarness({ resolver });

    await assert.rejects(async () => {
      await helpers.waitFor({
        key: "secret.button",
        timeoutMs: 450,
        intervalMs: 100,
        debug: true
      });
    }, (error: unknown) => {
      const details = error as { code?: string; pollCount?: number };
      assert.equal(details?.code, "resolver-miss");
      assert.ok((details?.pollCount ?? 0) >= 1, "failure event should include poll count");
      return true;
    });

    const failureEvents = getTelemetryPayloads(telemetryEvents, "failure");
    assert.equal(failureEvents.length, 1, "failure telemetry event expected");
    const failurePayload = failureEvents[0] as { pollCount?: number } | undefined;
    assert.ok((failurePayload?.pollCount ?? 0) >= 1, "failure event should include poll count");

    const failureLog = loggerEntries.find((entry) => entry.level === "debug" && entry.message === "wait:error");
    assert.ok(failureLog, "error log captured");
    assert.equal(failureLog!.data?.key, "[***masked***]", "sanitized key expected in logs");

    assert.ok(clock.now() >= 450, "fake clock should advance with polling");
  });
});

test("wait helpers recover from stale nodes, respect presence thresholds, and trigger scroll integration", { concurrency: false }, async () => {
  await withDomEnvironment(async () => {
    const scroller = new TestElement();
    scroller.scrollHeight = 2000;
    scroller.clientHeight = 400;

    let mainPoll = 0;
    const target = new TestElement("Virtual Row");
    target.isConnected = false;

    const resolver: WaitResolver = {
      resolve(key: string): ResolveResult {
        if (key === "listScroller") {
          return {
            key,
            element: scroller,
            attempts: [
              buildAttempt({ type: "css", selector: ".list" }, true, scroller)
            ],
            resolvedBy: { type: "css", selector: ".list" }
          } satisfies ResolveResult;
        }

        mainPoll += 1;

        if (mainPoll === 1) {
          return {
            key,
            element: null,
            attempts: [
              buildAttempt({ type: "css", selector: ".row" }, false)
            ]
          } satisfies ResolveResult;
        }

        if (mainPoll === 2) {
          target.isConnected = false;
          return {
            key,
            element: target,
            attempts: [
              buildAttempt({ type: "css", selector: ".row" }, true, target)
            ],
            resolvedBy: { type: "css", selector: ".row" }
          } satisfies ResolveResult;
        }

        target.isConnected = true;
        return {
          key,
          element: target,
          attempts: [
            buildAttempt({ type: "css", selector: ".row" }, true, target)
          ],
          resolvedBy: { type: "css", selector: ".row" }
        } satisfies ResolveResult;
      }
    };

    const { helpers, telemetryEvents, loggerEntries } = createWaitHelpersHarness({ resolver });

    const result = await helpers.waitFor({
      key: "virtualRow",
      scrollerKey: "listScroller",
      presenceThreshold: 2,
      timeoutMs: 5000,
      debug: true
    });

    assert.equal(result.target, target);
    assert.ok(result.staleRecoveries >= 1, "stale recoveries should be tracked");
    assert.ok(result.pollCount >= 3, "presence threshold should require multiple polls");

    assert.ok(scroller.scrollTop > 0, "scroll integration should adjust scroll position");

    const scrollLog = loggerEntries.find((entry) => entry.message === "wait:scroll-integration");
    assert.ok(scrollLog, "scroll integration debug log expected");

    const successPayloads = getTelemetryPayloads(telemetryEvents, "success");
    assert.equal(successPayloads.length, 1, "success telemetry expected");
    const successPayload = successPayloads[0] as { staleRecoveries?: number } | undefined;
    assert.ok((successPayload?.staleRecoveries ?? 0) >= 1);
  });
});
