import { test } from "node:test";
import assert from "node:assert/strict";

import {
  runWorkflow,
  type WorkflowResolver,
  type WorkflowResolverRequest
} from "../engine/runtime";
import { createDefaultScheduler } from "../engine/scheduler";
import { WorkflowTelemetryAdapter } from "../telemetry/runtime";
import { WorkflowEventRecorder } from "../telemetry/recorder";
import {
  InMemoryWorkflowContext,
  type WorkflowDefinition,
  type WorkflowHandlers
} from "../types";
import { StepError } from "../engine/errors";
import { createLogHandler } from "../actions/log";

const failingResolver: WorkflowResolver = {
  async resolve(_request: WorkflowResolverRequest) {
    return {
      key: "logical",
      element: null,
      attempts: []
    };
  }
};

test("WorkflowEventRecorder captures sanitized timeline", async () => {
  const recorder = new WorkflowEventRecorder();
  const telemetry = new WorkflowTelemetryAdapter({
    observers: [recorder]
  });

  const handlers: WorkflowHandlers = {
    log: createLogHandler(),
    capture: () => {
      throw new StepError({
        reason: "unknown",
        message: "capture failed",
        stepKind: "capture",
        data: {
          password: "super-secret"
        }
      });
    }
  };

  const definition: WorkflowDefinition = {
    id: "recorder-test",
    steps: [
      { kind: "log", message: "start", data: { password: "super-secret" } },
      {
        kind: "capture",
        to: "ctx.secret",
        from: { kind: "text", key: "logical" }
      }
    ]
  };

  const runId = "recorder-run";

  await runWorkflow(definition, {
    handlers,
    scheduler: createDefaultScheduler(),
    resolver: failingResolver,
    telemetry,
    context: new InMemoryWorkflowContext(),
    runId
  });

  const timeline = recorder.timeline(runId);

  assert.ok(timeline.some((entry) => entry.kind === "run" && entry.phase === "started"));
  assert.ok(timeline.some((entry) => entry.kind === "run" && entry.status === "failed"));
  assert.ok(timeline.some((entry) => entry.kind === "step" && entry.status === "attempt"));

  const logSuccess = timeline.find(
    (entry): entry is typeof entry & { kind: "step" } => entry.kind === "step" && entry.event.stepKind === "log" && entry.status === "success"
  );

  assert.ok(logSuccess);
  assert.equal((logSuccess.event.data as { password?: string })?.password, "********");

  const failureEvent = timeline.find(
    (entry): entry is typeof entry & { kind: "step" } => entry.kind === "step" && entry.status === "failure"
  );

  assert.ok(failureEvent);
  assert.equal(failureEvent.event.error?.data?.password, "********");

  const runRecord = recorder.getRun(runId);
  assert.ok(runRecord);
  assert.equal(runRecord?.status, "failed");
  assert.equal(runRecord?.error?.data?.password, "********");

  const runs = recorder.listRuns();
  assert.ok(runs.some((run) => run.runId === runId));
});
