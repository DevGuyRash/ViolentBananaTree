import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildScrollStep,
  buildWaitStep,
  exportRecorderWorkflowSteps,
  type RecordedScrollExport,
  type RecordedWaitExport
} from "../../../recorder/src/to-workflow";
import { registerCaptureHooks } from "../../../core/utils/scroll/recording";

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
  assert.equal(result.scrollAnnotations.length, 0);
});

test("buildScrollStep serializes scrollUntil metadata and annotations", () => {
  const hooks = registerCaptureHooks({
    stop: {
      kind: "list-growth",
      parentKey: "feed.container",
      itemCss: ".feed-item",
      minDelta: 2
    },
    container: {
      strategy: "hint",
      key: "feed.scroller",
      fallbackKeys: ["feed.fallback"],
      css: ".scroll-area",
      anchorKey: "feed.anchor"
    },
    tuning: {
      stepPx: 160,
      timeoutMs: 4800,
      delayMs: 200
    },
    notes: ["Captured feed scroll"]
  });

  hooks.addNote("Captured feed scroll");
  hooks.setTelemetry({ runId: "scroll-run-42" });

  const context = hooks.finalize();

  const entry: RecordedScrollExport = {
    kind: "scrollUntil",
    context,
    id: "scroll-1",
    name: "Scroll feed",
    description: "Scroll until feed grows",
    tags: ["recorder", "scroll"],
    debug: true,
    options: {
      telemetry: {
        includeAttempts: true,
        eventPrefix: "[DGX] recorder"
      },
      metadata: {
        custom: "value"
      }
    },
    metadata: {
      extra: {
        detail: "info"
      }
    },
    annotations: {
      extra: true
    },
    notes: ["Recorder adds extra note"]
  } satisfies RecordedScrollExport;

  const { step, annotations } = buildScrollStep(entry);

  assert.equal(step.kind, "scrollUntil");
  assert.equal(step.id, "scroll-1");
  assert.equal(step.name, "Scroll feed");
  assert.equal(step.description, "Scroll until feed grows");
  assert.equal(step.debug, true);
  assert.ok(step.tags?.includes("recorder"));
  assert.equal(step.timeoutMs, 4800);
  assert.equal(step.options.until.kind, "list-growth");
  assert.equal(step.options.containerKey, "feed.scroller");
  assert.equal(step.options.containerCss, "[***masked***]");
  assert.equal(step.options.anchorKey, "feed.anchor");
  assert.equal(step.options.telemetry?.includeAttempts, true);
  assert.equal(step.options.telemetry?.eventPrefix, "[DGX] recorder");
  assert.equal(step.options.metadata?.custom, "value");

  const recorderMeta = step.options.metadata?.recorder as Record<string, unknown>;
  assert.ok(recorderMeta);
  const recorderScroll = recorderMeta.scroll as Record<string, unknown>;
  assert.equal(recorderScroll?.mode, "list-growth");
  const telemetryMeta = recorderMeta.telemetry as Record<string, unknown>;
  assert.equal(telemetryMeta?.runId, "scroll-run-42");

  assert.ok(step.annotations?.scroll);
  assert.equal((step.annotations?.scroll as { mode: string }).mode, "list-growth");
  assert.equal((step.annotations?.extra as boolean | undefined), true);

  assert.equal(annotations?.mode, "list-growth");
  assert.equal(annotations?.guidance[0], "Recorder scroll list growth");
  assert.deepEqual(annotations?.notes, ["Captured feed scroll", "Recorder adds extra note"]);

  const exported = exportRecorderWorkflowSteps([{ kind: "scroll", scroll: entry }]);
  assert.equal(exported.steps.length, 1);
  assert.equal(exported.waitAnnotations.length, 0);
  assert.equal(exported.scrollAnnotations.length, 1);
  assert.equal(exported.scrollAnnotations[0]?.mode, "list-growth");
});
