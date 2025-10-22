import { test } from "node:test";
import assert from "node:assert/strict";

import {
  runWorkflow,
  cancelRun,
  type WorkflowResolver,
  type WorkflowResolverRequest
} from "../engine/runtime";
import { createDefaultScheduler } from "../engine/scheduler";
import { WorkflowTelemetryAdapter } from "../telemetry/runtime";
import {
  InMemoryWorkflowContext,
  type WorkflowDefinition,
  type WorkflowHandlers,
  type StepTelemetryEvent
} from "../types";

const noopResolver: WorkflowResolver = {
  async resolve(_request: WorkflowResolverRequest) {
    return {
      key: "noop",
      element: null,
      attempts: []
    };
  }
};

function createHandlers(onInvoke: () => void, shouldFail = false): WorkflowHandlers {
  return {
    log() {
      onInvoke();
      if (shouldFail) {
        throw new Error("handler failure");
      }
    }
  };
}

function collectTelemetry(): {
  telemetry: WorkflowTelemetryAdapter;
  stepEvents: StepTelemetryEvent[];
  runEvents: Array<{ phase: string; status: string }>;
} {
  const stepEvents: StepTelemetryEvent[] = [];
  const runEvents: Array<{ phase: string; status: string }> = [];

  const telemetry = new WorkflowTelemetryAdapter({
    stepListeners: [
      (events) => {
        stepEvents.push(...events);
      }
    ],
    runListeners: [
      (event, phase) => {
        runEvents.push({ phase, status: event.status });
      }
    ]
  });

  return { telemetry, stepEvents, runEvents };
}

test("runWorkflow executes steps and reports success", async () => {
  const executed: string[] = [];
  const handlers = createHandlers(() => executed.push("log"));
  const { telemetry, stepEvents, runEvents } = collectTelemetry();

  const definition: WorkflowDefinition = {
    id: "success-workflow",
    steps: [
      {
        kind: "log",
        message: "hello"
      }
    ]
  };

  const outcome = await runWorkflow(definition, {
    handlers,
    scheduler: createDefaultScheduler(),
    resolver: noopResolver,
    telemetry,
    context: new InMemoryWorkflowContext(),
    runId: "run-success"
  });

  assert.equal(outcome.status, "success");
  assert.equal(outcome.completedSteps, 1);
  assert.deepEqual(executed, ["log"]);
  assert.ok(stepEvents.some((event) => event.status === "success"));
  assert.ok(runEvents.some((entry) => entry.phase === "completed" && entry.status === "success"));
});

test("runWorkflow surfaces handler failures as failed outcome", async () => {
  const handlers = createHandlers(() => undefined, true);
  const { telemetry, stepEvents } = collectTelemetry();

  const definition: WorkflowDefinition = {
    id: "failure-workflow",
    steps: [
      {
        kind: "log",
        message: "boom"
      }
    ]
  };

  const outcome = await runWorkflow(definition, {
    handlers,
    scheduler: createDefaultScheduler(),
    resolver: noopResolver,
    telemetry,
    context: new InMemoryWorkflowContext(),
    runId: "run-failure"
  });

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.completedSteps, 0);
  assert.ok(outcome.error);
  assert.ok(stepEvents.some((event) => event.status === "failure"));
});

