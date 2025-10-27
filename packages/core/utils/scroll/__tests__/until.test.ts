import test from "node:test";
import assert from "node:assert/strict";

import {
  createScrollUntilRunner,
  type ScrollUntilPredicateContext,
  type ScrollUntilPredicateRegistry,
  type ScrollUntilPredicateResult,
  type ScrollUntilStopCondition,
  type ScrollUntilTelemetry,
  type ScrollUntilTelemetryAttemptEvent,
  type ScrollUntilTelemetryStartEvent,
  type ScrollUntilTelemetryCompleteEvent
} from "../until";

interface FakeContainer extends Element {
  nodeType: 1;
  scrollTop: number;
  scrollLeft: number;
  scrollHeight: number;
  scrollWidth: number;
  clientHeight: number;
  clientWidth: number;
  scroll(x: number, y: number): void;
  scrollTo(x: number, y: number): void;
  getBoundingClientRect(): DOMRect;
}

type PredicateFactory = (context: ScrollUntilPredicateContext) => ScrollUntilPredicateResult;

class TestPredicateRegistry implements ScrollUntilPredicateRegistry {
  private readonly factory: PredicateFactory;

  constructor(factory: PredicateFactory) {
    this.factory = factory;
  }
  evaluate(_condition: ScrollUntilStopCondition, context: ScrollUntilPredicateContext): ScrollUntilPredicateResult {
    return this.factory(context);
  }
}

function createFakeContainer(config: {
  clientHeight: number;
  scrollHeight: number;
  clientWidth?: number;
  scrollWidth?: number;
  initialTop?: number;
}): FakeContainer {
  const element = {
    nodeType: 1 as const,
    scrollTop: config.initialTop ?? 0,
    scrollLeft: 0,
    scrollHeight: config.scrollHeight,
    scrollWidth: config.scrollWidth ?? 1000,
    clientHeight: config.clientHeight,
    clientWidth: config.clientWidth ?? 800,
    scroll(x: number, y: number) {
      this.scrollLeft = x;
      this.scrollTop = y;
    },
    scrollTo(x: number, y: number) {
      this.scrollLeft = x;
      this.scrollTop = y;
    },
    getBoundingClientRect(): DOMRect {
      return {
        top: 0,
        left: 0,
        right: this.clientWidth,
        bottom: this.clientHeight,
        width: this.clientWidth,
        height: this.clientHeight
      } as DOMRect;
    }
  } as unknown as FakeContainer;

  return element;
}

function createIncrementingClock(incrementPerCall = 0) {
  let current = 0;
  return {
    clock: {
      now(): number {
        const value = current;
        current += incrementPerCall;
        return value;
      }
    },
    advance(ms: number) {
      current += ms;
    },
    get value(): number {
      return current;
    }
  };
}

test("scrollUntil succeeds when predicate satisfied within attempts", async () => {
  const container = createFakeContainer({ clientHeight: 200, scrollHeight: 1200 });
  const clock = createIncrementingClock();

  const registry = new TestPredicateRegistry((context) => {
    if (context.attempt >= 3) {
      return { satisfied: true, reason: "target-detected", snapshot: { attempt: context.attempt } } satisfies ScrollUntilPredicateResult;
    }
    return { satisfied: false } satisfies ScrollUntilPredicateResult;
  });

  const runner = createScrollUntilRunner({
    predicateRegistry: registry,
    clock: clock.clock,
    sleep: async (ms) => {
      clock.advance(ms);
    },
    runIdFactory: () => "run-success"
  });

  const result = await runner.run({
    until: { kind: "end" },
    container,
    stepPx: 400,
    timeoutMs: 5000
  });

  assert.equal(result.status, "success");
  assert.equal(result.attempts, 3);
  assert.equal(result.reason, "target-detected");
  assert.ok(result.config.stepPx <= 500);
  assert.equal(result.cumulativeDelta.y, container.scrollTop);
  assert.ok(result.cumulativeDelta.y <= container.scrollHeight - container.clientHeight);
  assert.deepEqual(result.predicateSnapshot, { attempt: 3 });
});

test("scrollUntil times out when deadline exceeded", async () => {
  const container = createFakeContainer({ clientHeight: 250, scrollHeight: 2000 });
  const clock = createIncrementingClock(60);

  const registry = new TestPredicateRegistry(() => ({ satisfied: false } satisfies ScrollUntilPredicateResult));

  const runner = createScrollUntilRunner({
    predicateRegistry: registry,
    clock: clock.clock,
    sleep: async (ms) => {
      clock.advance(ms);
    },
    runIdFactory: () => "run-timeout"
  });

  const result = await runner.run({
    until: { kind: "element", key: "missing" },
    container,
    timeoutMs: 50,
    maxAttempts: 10
  });

  assert.equal(result.status, "timeout");
  assert.equal(result.reason, "timeout-exceeded");
  assert.ok(result.attempts >= 1);
});

test("scrollUntil reports no_change when movement stalls", async () => {
  const container = createFakeContainer({
    clientHeight: 300,
    scrollHeight: 600,
    initialTop: 300
  });

  const clock = createIncrementingClock();

  const registry = new TestPredicateRegistry(() => ({ satisfied: false, reason: "waiting" } satisfies ScrollUntilPredicateResult));

  const runner = createScrollUntilRunner({
    predicateRegistry: registry,
    clock: clock.clock,
    sleep: async (ms) => {
      clock.advance(ms);
    },
    runIdFactory: () => "run-no-change"
  });

  const result = await runner.run({
    until: { kind: "end" },
    container
  });

  assert.equal(result.status, "no_change");
  assert.equal(result.reason, "waiting");
  assert.equal(result.attempts, 2);
  assert.equal(result.consecutiveNoChange, 2);
});

test("scrollUntil clamps step and delay budgets", async () => {
  const container = createFakeContainer({ clientHeight: 400, scrollHeight: 4000 });
  const clock = createIncrementingClock();

  const registry = new TestPredicateRegistry(() => ({ satisfied: false } satisfies ScrollUntilPredicateResult));

  const runner = createScrollUntilRunner({
    predicateRegistry: registry,
    clock: clock.clock,
    sleep: async (ms) => {
      clock.advance(ms);
    },
    runIdFactory: () => "run-clamp"
  });

  const result = await runner.run({
    until: { kind: "end" },
    container,
    stepPx: 1200,
    delayMs: 2500,
    maxAttempts: 1
  });

  assert.equal(result.config.stepPx, 500);
  assert.equal(result.config.delayMs, 1000);
  assert.equal(result.lastDelta.y, 500);
  assert.equal(result.status, "timeout");
  assert.equal(result.reason, "max-attempts-exhausted");
});

test("scrollUntil emits telemetry across lifecycle", async () => {
  const container = createFakeContainer({ clientHeight: 250, scrollHeight: 1500 });
  const clock = createIncrementingClock();

  const registry = new TestPredicateRegistry((context) => {
    if (context.attempt >= 2) {
      return { satisfied: true, reason: "found" } satisfies ScrollUntilPredicateResult;
    }
    return { satisfied: false } satisfies ScrollUntilPredicateResult;
  });

  const starts: ScrollUntilTelemetryStartEvent[] = [];
  const attempts: ScrollUntilTelemetryAttemptEvent[] = [];
  const completes: ScrollUntilTelemetryCompleteEvent[] = [];

  const telemetry: ScrollUntilTelemetry = {
    onStart(event) {
      starts.push(event);
    },
    onAttempt(event) {
      attempts.push(event);
    },
    onComplete(event) {
      completes.push(event);
    }
  } satisfies ScrollUntilTelemetry;

  const runner = createScrollUntilRunner({
    predicateRegistry: registry,
    clock: clock.clock,
    sleep: async (ms) => {
      clock.advance(ms);
    },
    runIdFactory: () => "run-telemetry"
  });

  const result = await runner.run({
    until: { kind: "element", key: "target" },
    container,
    telemetry
  });

  assert.equal(result.status, "success");
  assert.equal(starts.length, 1);
  assert.equal(attempts.length, 2);
  assert.equal(attempts.at(-1)?.status, "success");
  assert.equal(completes.length, 1);
  assert.equal(completes[0].result.status, "success");
  assert.equal(completes[0].result.runId, "run-telemetry");
});
