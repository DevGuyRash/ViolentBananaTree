import test from "node:test";
import assert from "node:assert/strict";

import {
  createScrollTelemetryAdapter,
  DEFAULT_SCROLL_EVENT_PREFIX,
  type ScrollTelemetryEventEnvelope
} from "../telemetry";
import type { ScrollUntilResult, ScrollUntilResolvedConfig } from "../until";

const DEFAULT_CONFIG: ScrollUntilResolvedConfig = {
  stepPx: 200,
  delayMs: 50,
  timeoutMs: 8000,
  maxAttempts: 10,
  minDeltaPx: 4
} satisfies ScrollUntilResolvedConfig;

test("scroll telemetry adapter emits sanitized start, attempt, and success events", () => {
  const events: ScrollTelemetryEventEnvelope[] = [];

  const adapter = createScrollTelemetryAdapter({
    notify: (event) => {
      events.push(event);
    },
    basePayload: {
      workflowId: "workflow-42",
      stepId: "step-3"
    }
  });

  adapter.onStart({
    runId: "run-1",
    mode: "element",
    startedAt: 100,
    config: DEFAULT_CONFIG,
    metadata: {
      targetSelector: ".list-item"
    },
    containerStrategy: "detected"
  });

  adapter.onAttempt({
    runId: "run-1",
    attempt: 1,
    elapsedMs: 120,
    delta: { x: 0, y: 120 },
    cumulativeDelta: { x: 0, y: 120 },
    status: "continue",
    reason: undefined,
    snapshot: {
      itemCount: 12,
      targetSelector: ".list-item"
    },
    domStable: false
  });

  adapter.onAttempt({
    runId: "run-1",
    attempt: 2,
    elapsedMs: 240,
    delta: { x: 0, y: 140 },
    cumulativeDelta: { x: 0, y: 260 },
    status: "success",
    reason: "predicate-satisfied",
    snapshot: {
      itemCount: 15,
      targetSelector: ".list-item"
    },
    domStable: true
  });

  adapter.onComplete({
    runId: "run-1",
    result: buildResult({
      status: "success",
      attempts: 2,
      startedAt: 100,
      finishedAt: 260,
      elapsedMs: 160,
      lastDelta: { x: 0, y: 140 },
      cumulativeDelta: { x: 0, y: 260 },
      reason: "predicate-satisfied",
      runId: "run-1",
      domStable: true,
      metadata: {
        targetSelector: ".list-item"
      },
      predicateSnapshot: {
        matchedSelector: ".list-item"
      }
    })
  });

  assert.equal(events.length, 3);

  const start = events[0];
  assert.equal(start.event, `${DEFAULT_SCROLL_EVENT_PREFIX}:start`);
  assert.equal(start.level, "info");
  assert.equal(start.payload.runId, "run-1");
  assert.equal(typeof start.payload.timestamp, "number");
  assert.equal(start.payload.metadata?.targetSelector, "[***masked***]");

  const attempt = events[1];
  assert.equal(attempt.event, `${DEFAULT_SCROLL_EVENT_PREFIX}:attempt`);
  assert.equal(attempt.payload.attempt, 1);
  assert.equal(attempt.payload.cumulativeDelta?.y, 120);
  assert.equal(attempt.payload.snapshot?.targetSelector, "[***masked***]");

  const success = events[2];
  assert.equal(success.event, `${DEFAULT_SCROLL_EVENT_PREFIX}:success`);
  assert.equal(success.level, "info");
  assert.equal(success.payload.status, "success");
  assert.equal(success.payload.predicateSnapshot?.matchedSelector, "[***masked***]");
  assert.equal(success.payload.metadata?.targetSelector, "[***masked***]");
});

test("scroll telemetry adapter maps timeout failures to error severity", () => {
  const events: ScrollTelemetryEventEnvelope[] = [];

  const adapter = createScrollTelemetryAdapter({
    notify: (event) => events.push(event),
    includeAttempts: false
  });

  adapter.onStart({
    runId: "run-timeout",
    mode: "end",
    startedAt: 0,
    config: DEFAULT_CONFIG,
    metadata: {
      containerSelector: "#feed"
    },
    containerStrategy: "detected"
  });

  adapter.onComplete({
    runId: "run-timeout",
    result: buildResult({
      status: "timeout",
      attempts: 5,
      startedAt: 0,
      finishedAt: 8000,
      elapsedMs: 8000,
      lastDelta: { x: 0, y: 0 },
      cumulativeDelta: { x: 0, y: 500 },
      reason: "timeout-exceeded",
      runId: "run-timeout",
      domStable: false,
      metadata: {
        targetSelector: "#feed"
      }
    })
  });

  assert.equal(events.length, 2);
  const failure = events.at(-1);
  assert.ok(failure);
  assert.equal(failure?.event, `${DEFAULT_SCROLL_EVENT_PREFIX}:failure`);
  assert.equal(failure?.level, "error");
  assert.equal(failure?.payload.reason, "timeout-exceeded");
  assert.equal(failure?.payload.metadata?.targetSelector, "[***masked***]");
});

test("scroll telemetry adapter emits no_change warnings with masked selectors", () => {
  const events: ScrollTelemetryEventEnvelope[] = [];

  const adapter = createScrollTelemetryAdapter({
    notify: (event) => events.push(event)
  });

  adapter.onStart({
    runId: "run-no-change",
    mode: "list-growth",
    startedAt: 10,
    config: DEFAULT_CONFIG,
    metadata: {
      targetSelector: "ul.items > li"
    },
    containerStrategy: "detected"
  });

  adapter.onAttempt({
    runId: "run-no-change",
    attempt: 4,
    elapsedMs: 420,
    delta: { x: 0, y: 0 },
    cumulativeDelta: { x: 0, y: 400 },
    status: "no_change",
    reason: "delta-below-threshold",
    snapshot: {
      listCount: 20,
      targetSelector: "ul.items > li"
    },
    domStable: true
  });

  adapter.onComplete({
    runId: "run-no-change",
    result: buildResult({
      status: "no_change",
      attempts: 4,
      startedAt: 10,
      finishedAt: 430,
      elapsedMs: 420,
      lastDelta: { x: 0, y: 0 },
      cumulativeDelta: { x: 0, y: 400 },
      reason: "delta-below-threshold",
      runId: "run-no-change",
      domStable: true,
      metadata: {
        targetSelector: "ul.items > li"
      }
    })
  });

  assert.equal(events.length, 2);

  const outcome = events.at(-1);
  assert.ok(outcome);
  assert.equal(outcome?.event, `${DEFAULT_SCROLL_EVENT_PREFIX}:no_change`);
  assert.equal(outcome?.level, "warn");
  assert.equal(outcome?.payload.status, "no_change");
  assert.equal(outcome?.payload.attempt, 4);
  assert.equal(outcome?.payload.predicateSnapshot?.targetSelector, "[***masked***]");
  assert.equal(outcome?.payload.metadata?.targetSelector, "[***masked***]");
});

function buildResult(
  overrides: Partial<ScrollUntilResult> &
    Pick<ScrollUntilResult, "status" | "attempts" | "startedAt" | "finishedAt" | "elapsedMs" | "lastDelta" | "cumulativeDelta" | "reason" | "runId">
): ScrollUntilResult {
  return {
    status: overrides.status,
    attempts: overrides.attempts,
    startedAt: overrides.startedAt,
    finishedAt: overrides.finishedAt,
    elapsedMs: overrides.elapsedMs,
    lastDelta: overrides.lastDelta,
    cumulativeDelta: overrides.cumulativeDelta,
    config: overrides.config ?? DEFAULT_CONFIG,
    reason: overrides.reason,
    container: null,
    runId: overrides.runId,
    predicateSnapshot: overrides.predicateSnapshot,
    domStable: overrides.domStable,
    consecutiveNoChange: overrides.consecutiveNoChange ?? 0,
    metadata: overrides.metadata
  } satisfies ScrollUntilResult;
}
