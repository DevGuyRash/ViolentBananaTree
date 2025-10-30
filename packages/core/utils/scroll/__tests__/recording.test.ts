import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatAnnotations,
  hydrateReplayContext,
  isRecorderScrollContext,
  registerCaptureHooks
} from "../recording";

test("registerCaptureHooks sanitizes captured context", () => {
  const hooks = registerCaptureHooks();

  hooks.setStop({
    kind: "list-growth",
    parentKey: "feed.container",
    itemCss: ".item[data-id='123']",
    minDelta: 3
  });

  hooks.setContainer({
    strategy: "hint",
    key: "list.root",
    fallbackKeys: ["password.input"],
    css: ".feed[data-scroll='secret']",
    hints: ["data-scroll"],
    anchorKey: "auth.token"
  });

  hooks.setTuning({
    stepPx: 240.6,
    timeoutMs: 9100,
    maxAttempts: 12
  });

  hooks.setPredicate({
    id: "predicate.secret",
    expression: "return document.querySelector('#secret')"
  });

  hooks.addNote("Captured feed scroll");
  hooks.addNote("Captured feed scroll");
  hooks.setTelemetry({ runId: "scroll.run#1" });

  const context = hooks.finalize();

  assert.equal(context.mode, "list-growth");
  assert.equal(context.stop.kind, "list-growth");
  assert.equal(context.stop.parentKey, "feed.container");
  assert.equal(context.stop.itemCss, "[***masked***]");
  assert.equal(context.tuning?.stepPx, 240);
  assert.equal(context.tuning?.timeoutMs, 9100);
  assert.deepEqual(context.tuning?.maxAttempts, 12);
  assert.equal(context.container?.hints?.[0], "data-scroll");
  assert.equal(context.container?.fallbackKeys?.[0], "[***masked***]");
  assert.equal(context.container?.css, "[***masked***]");
  assert.equal(context.container?.anchorKey, "[***masked***]");
  assert.equal(context.predicate?.id, "[***masked***]");
  assert.equal(context.predicate?.expression, "[***masked***]");
  assert.equal(context.notes?.length, 1);
  assert.ok(isRecorderScrollContext(context));

  const metadata = hydrateReplayContext(context);
  assert.ok(metadata);
  assert.equal(metadata?.container?.css, "[***masked***]");

  const annotation = formatAnnotations(context);
  assert.ok(annotation);
  assert.equal(annotation?.guidance[0], "Recorder scroll list growth");
  assert.equal(annotation?.guidance.length >= 2, true);
});
