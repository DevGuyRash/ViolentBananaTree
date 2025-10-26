import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildWaitStep,
  exportRecorderWorkflowSteps,
  type RecordedWaitExport
} from "../../../recorder/src/to-workflow";

test("buildWaitStep produces waitText with annotations and guidance", () => {
  const entry: RecordedWaitExport = {
    kind: "waitText",
    key: "hero.title",
    predicate: {
      kind: "text",
      expected: "Super Secret",
      exact: false,
      caseSensitive: false,
      scopeKey: "hero.container",
      textSensitive: true
    },
    hints: {
      presenceThreshold: 3,
      scrollerKey: "list.scroller",
      staleRetryCap: 4
    },
    budgets: {
      timeoutMs: 4000,
      intervalMs: 120
    },
    debug: true,
    notes: ["Captured during onboarding"]
  } satisfies RecordedWaitExport;

  const { step, annotations } = buildWaitStep(entry);

  assert.equal(step.kind, "waitText");
  assert.equal(step.text, "Super Secret");
  assert.equal(step.withinKey, "hero.container");
  assert.equal(step.presenceThreshold, 3);
  assert.equal(step.scrollerKey, "list.scroller");
  assert.equal(step.staleRetryCap, 4);
  assert.equal(step.debug, true);
  assert.ok(Array.isArray(step.tags));
  assert.ok(step.tags?.includes("recorder:wait"));
  assert.ok(step.tags?.includes("recorder:wait:waitText"));
  assert.equal(step.annotations?.wait, annotations);

  assert.equal(annotations.source, "recorder");
  assert.equal(annotations.kind, "waitText");
  assert.equal(annotations.predicate.kind, "text");
  assert.equal(annotations.predicate.expectedPreview, "********");
  assert.equal(annotations.hints.presenceThreshold, 3);
  assert.equal(annotations.hints.scrollerKey, "list.scroller");
  assert.equal(annotations.hints.staleRetryCap, 4);
  assert.equal(annotations.budgets.timeoutMs, 4000);
  assert.equal(annotations.budgets.intervalMs, 120);
  assert.ok(Array.isArray(annotations.guidance));
  assert.ok((annotations.guidance[0] ?? "").includes("timeout 4000ms"));
  assert.equal(annotations.notes?.[0], "Captured during onboarding");
});

test("buildWaitStep produces idle wait with idle annotations", () => {
  const entry: RecordedWaitExport = {
    kind: "waitForIdle",
    key: "dashboard.feed",
    predicate: {
      kind: "idle",
      scopeKey: "dashboard.root",
      idle: {
        idleMs: 600,
        maxWindowMs: 5000,
        heartbeatMs: 250,
        captureStatistics: true
      }
    },
    hints: {
      presenceThreshold: 2
    }
  } satisfies RecordedWaitExport;

  const { step, annotations } = buildWaitStep(entry);

  assert.equal(step.kind, "waitForIdle");
  assert.equal(step.key, "dashboard.feed");
  assert.equal(step.scopeKey, "dashboard.root");
  assert.equal(step.idleMs, 600);
  assert.equal(step.maxWindowMs, 5000);
  assert.equal(step.heartbeatMs, 250);
  assert.equal(step.captureStatistics, true);
  assert.equal(step.presenceThreshold, 2);

  assert.equal(annotations.kind, "waitForIdle");
  assert.equal(annotations.idle?.idleMs, 600);
  assert.equal(annotations.idle?.maxWindowMs, 5000);
  assert.ok(annotations.guidance.some((item) => item.includes("mutation silence")));
});

test("exportRecorderWorkflowSteps preserves non-wait steps and aggregates annotations", () => {
  const waitEntry: RecordedWaitExport = {
    kind: "waitVisible",
    key: "user.password",
    predicate: {
      kind: "visible",
      requireDisplayed: true
    }
  } satisfies RecordedWaitExport;

  const passthroughStep: WorkflowStep = {
    kind: "log",
    message: "Finished wait"
  };

  const result = exportRecorderWorkflowSteps([
    { kind: "wait", wait: waitEntry },
    { kind: "passthrough", step: passthroughStep }
  ]);

  assert.equal(result.steps.length, 2);
  const [waitStep, logStep] = result.steps;
  assert.equal(waitStep.kind, "waitVisible");
  assert.equal(logStep.kind, "log");
  assert.equal(result.waitAnnotations.length, 1);
  assert.equal(result.waitAnnotations[0]?.resolver.key, "********");
});
