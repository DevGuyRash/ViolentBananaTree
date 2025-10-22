import { test } from "node:test";
import assert from "node:assert/strict";

import {
  runWorkflow,
  type WorkflowResolver,
  type WorkflowResolverRequest
} from "../../engine/runtime";
import { createDefaultScheduler } from "../../engine/scheduler";
import { WorkflowTelemetryAdapter } from "../../telemetry/runtime";
import {
  InMemoryWorkflowContext,
  type WorkflowDefinition,
  type WorkflowHandlers,
  type StepTelemetryEvent
} from "../../types";
import { StepError } from "../../engine/errors";

const resolver: WorkflowResolver = {
  async resolve(_request: WorkflowResolverRequest) {
    return {
      key: "logical",
      element: null,
      attempts: []
    };
  }
};

test("telemetry adapter batches events and masks sensitive payloads", async () => {
  const stepEvents: StepTelemetryEvent[] = [];
  const runPhases: string[] = [];

  const telemetry = new WorkflowTelemetryAdapter({
    stepListeners: [
      (events) => {
        stepEvents.push(...events);
      }
    ],
    runListeners: [
      (event, phase) => {
        runPhases.push(`${phase}:${event.status}`);
      }
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
          password: "secret-value"
        }
      });
    }
  };

  const definition: WorkflowDefinition = {
    id: "telemetry-test",
    steps: [
      {
        kind: "log",
        message: "start"
      },
      {
        kind: "capture",
        to: "ctx.target",
        from: { kind: "text", key: "logical" }
      }
    ]
  };

  const outcome = await runWorkflow(definition, {
    handlers,
    scheduler: createDefaultScheduler(),
    resolver,
    telemetry,
    context: new InMemoryWorkflowContext(),
    runId: "telemetry-run"
  });

  assert.equal(outcome.status, "failed");
  assert.ok(outcome.error);
  assert.ok(runPhases.includes("started:running"));
  assert.ok(runPhases.includes("completed:failed"));

  const statuses = stepEvents.map((event) => ({ index: event.stepIndex, status: event.status }));
  assert.deepEqual(statuses.filter((entry) => entry.index === 0).map((entry) => entry.status), [
    "pending",
    "attempt",
    "success"
  ]);
  assert.deepEqual(statuses.filter((entry) => entry.index === 1).map((entry) => entry.status), [
    "pending",
    "attempt",
    "failure"
  ]);

  const failureEvent = stepEvents.find((event) => event.stepIndex === 1 && event.status === "failure");
  assert.ok(failureEvent && failureEvent.error);
  assert.equal(failureEvent!.error!.data?.password, "********");
});
