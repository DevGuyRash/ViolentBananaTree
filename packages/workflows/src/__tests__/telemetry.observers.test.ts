import { test } from "node:test";
import assert from "node:assert/strict";

import {
  runWorkflow,
  type WorkflowResolver,
  type WorkflowResolverRequest
} from "../engine/runtime";
import { createDefaultScheduler } from "../engine/scheduler";
import { WorkflowTelemetryAdapter } from "../telemetry/runtime";
import {
  InMemoryWorkflowContext,
  type WorkflowDefinition,
  type WorkflowHandlers
} from "../types";
import { StepError } from "../engine/errors";
import { createHudTelemetryObserver } from "../../../scripts/telemetry-observers";
import type { HudNotification } from "../../../menu/hud";

const resolver: WorkflowResolver = {
  async resolve(_request: WorkflowResolverRequest) {
    return {
      key: "logical",
      element: null,
      attempts: []
    };
  }
};

test("HUD observer receives workflow lifecycle notifications", async () => {
  const notifications: HudNotification[] = [];

  const telemetry = new WorkflowTelemetryAdapter({
    observers: [
      createHudTelemetryObserver({
        notify: (notification) => {
          notifications.push(notification);
        }
      })
    ]
  });

  const handlers: WorkflowHandlers = {
    log: () => {},
    capture: () => {
      throw new StepError({
        reason: "unknown",
        message: "capture failed",
        stepKind: "capture",
        data: {
          token: "abc123"
        }
      });
    }
  };

  const definition: WorkflowDefinition = {
    id: "hud-test",
    steps: [
      { kind: "log", message: "start" },
      {
        kind: "capture",
        to: "ctx.secret",
        from: { kind: "text", key: "logical" }
      }
    ]
  };

  await runWorkflow(definition, {
    handlers,
    scheduler: createDefaultScheduler(),
    resolver,
    telemetry,
    context: new InMemoryWorkflowContext(),
    runId: "hud-run"
  });

  const titles = notifications.map((notification) => notification.title);

  assert.ok(titles.some((title) => title.includes("Workflow hud-test started")));
  assert.ok(titles.some((title) => title.includes("Workflow hud-test failed")));
  assert.ok(titles.some((title) => title.includes("Step attempt")));
  assert.ok(titles.some((title) => title.includes("Step failure")));

  const failureNotification = notifications.find((notification) => notification.title.endsWith("Step failure"));
  assert.ok(failureNotification);
  const metadata = failureNotification.metadata as { [key: string]: unknown };
  const error = metadata?.error as { data?: Record<string, unknown> } | undefined;
  assert.equal(error?.data?.token, "********");
});
