import { test } from "node:test";
import assert from "node:assert/strict";

import {
  runWorkflow,
  type WorkflowScheduler,
  type WorkflowSchedulerEnvironment
} from "../engine/runtime";
import { createDefaultScheduler } from "../engine/scheduler";
import { WorkflowTelemetryAdapter } from "../telemetry/runtime";
import {
  DEFAULT_RUNTIME_TIMING,
  type RuntimeTimingConfig
} from "../config";
import {
  InMemoryWorkflowContext,
  type WorkflowDefinition,
  type WorkflowHandlers,
  type WorkflowResolver,
  type WorkflowRunOutcome,
  type StepTelemetryEvent,
  type LogStep,
  type SetContextStep,
  type ForeachStep
} from "../types";
import { StepError } from "../engine/errors";

const resolver: WorkflowResolver = {
  async resolve() {
    return {
      key: "logical",
      element: null,
      attempts: []
    };
  }
};

function createDefinition(step: WorkflowDefinition["steps"][number]): WorkflowDefinition {
  return {
    id: `wf-${step.kind}`,
    steps: [step]
  } satisfies WorkflowDefinition;
}

test("runWorkflow injects default timing when no overrides are supplied", async () => {
  let captured: WorkflowSchedulerEnvironment | undefined;

  const scheduler: WorkflowScheduler = {
    async run(env) {
      captured = env;
      return {
        status: "success",
        completedSteps: 0
      };
    }
  };

  const definition = createDefinition({
    kind: "log",
    message: "noop"
  } satisfies LogStep);

  await runWorkflow(definition, {
    handlers: {
      log: () => {}
    },
    resolver,
    scheduler,
    context: new InMemoryWorkflowContext(),
    runId: "defaults"
  });

  assert.ok(captured, "scheduler environment was not captured");
  assert.deepEqual(captured?.timing, DEFAULT_RUNTIME_TIMING);
});

test("workflow defaults merge with runtime overrides", async () => {
  let captured: RuntimeTimingConfig | undefined;

  const scheduler: WorkflowScheduler = {
    async run(env) {
      captured = env.timing;
      return {
        status: "success",
        completedSteps: 0
      };
    }
  };

  const definition: WorkflowDefinition = {
    id: "workflow-defaults",
    defaults: {
      timeoutMs: 5000,
      retries: 2,
      backoffMs: 300,
      jitterMs: 50
    },
    steps: [
      {
        kind: "log",
        message: "merge"
      } satisfies LogStep
    ]
  };

  await runWorkflow(definition, {
    handlers: {
      log: () => {}
    },
    resolver,
    scheduler,
    timingOverrides: {
      intervalMs: 75,
      retries: 3
    },
    context: new InMemoryWorkflowContext(),
    runId: "overrides"
  });

  assert.ok(captured);
  assert.equal(captured?.timeoutMs, 5000);
  assert.equal(captured?.intervalMs, 75);
  assert.equal(captured?.retries, 3);
  assert.equal(captured?.backoffMs, 300);
  assert.equal(captured?.jitterMs, 50);
});

test("default scheduler applies retries with exponential backoff", async (t) => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalRandom = Math.random;
  const waits: number[] = [];

  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, ms?: number) => {
    const delay = typeof ms === "number" ? ms : 0;
    waits.push(delay);
    queueMicrotask(() => {
      callback();
    });
    return { __mockTimer: delay } as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;

  globalThis.clearTimeout = (() => undefined) as typeof clearTimeout;
  Math.random = () => 0.5;

  t.after(() => {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    Math.random = originalRandom;
  });

  let invocationCount = 0;
  const scheduler = createDefaultScheduler();
  const telemetryEvents: StepTelemetryEvent[] = [];
  const telemetry = new WorkflowTelemetryAdapter({
    stepListeners: [
      (events) => {
        telemetryEvents.push(...events);
      }
    ]
  });

  const handlers: WorkflowHandlers = {
    log: (args) => {
      invocationCount += 1;

      if (invocationCount < 3) {
        throw new Error(`fail ${invocationCount}`);
      }

      return {
        status: "success",
        notes: `attempt ${args.attempt}`
      };
    }
  } satisfies WorkflowHandlers;

  const definition: WorkflowDefinition = {
    id: "retry-sequence",
    steps: [
      {
        kind: "log",
        message: "retry",
        retries: 2
      } satisfies LogStep
    ]
  };

  const outcome = await runWorkflow(definition, {
    handlers,
    resolver,
    scheduler,
    telemetry,
    context: new InMemoryWorkflowContext(),
    runId: "retry-run"
  });

  assert.equal(outcome.status, "success");
  assert.equal(invocationCount, 3);

  const backoffDelays = waits.filter((delay) => delay >= 200 && delay <= 1500);
  assert.deepEqual(backoffDelays, [500, 1000]);

  const failureEvents = telemetryEvents.filter((event) => event.status === "failure");
  assert.equal(failureEvents.length, 2);
  const successEvent = telemetryEvents.find((event) => event.status === "success");
  assert.ok(successEvent);
});

test("runWorkflow surfaces structured failure telemetry", async () => {
  const scheduler = createDefaultScheduler();
  const telemetryEvents: StepTelemetryEvent[] = [];
  const telemetry = new WorkflowTelemetryAdapter({
    stepListeners: [
      (events) => {
        telemetryEvents.push(...events);
      }
    ]
  });

  const handlers: WorkflowHandlers = {
    click: (args) => {
      throw new StepError({
        reason: "unknown",
        message: "boom",
        stepKind: args.step.kind,
        stepId: args.step.id,
        logicalKey: (args.step as { key: string }).key,
        attempts: args.attempt,
        elapsedMs: 4
      });
    }
  } satisfies WorkflowHandlers;

  const failureResolver: WorkflowResolver = {
    async resolve(request) {
      return {
        key: request.step.key,
        element: {} as Element,
        attempts: []
      };
    }
  };

  const definition: WorkflowDefinition = {
    id: "structured-failure",
    steps: [
      {
        kind: "click",
        key: "checkout.primary",
        retries: 1
      }
    ]
  };

  const outcome = await runWorkflow(definition, {
    handlers,
    resolver: failureResolver,
    scheduler,
    telemetry,
    context: new InMemoryWorkflowContext(),
    runId: "failure-run"
  });

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.completedSteps, 0);
  assert.ok(outcome.error);
  assert.equal(outcome.error?.logicalKey, "checkout.primary");
  assert.equal(outcome.error?.attempts, 2);

  const failureEvent = telemetryEvents.find((event) => event.status === "failure");
  assert.ok(failureEvent);
  assert.equal(failureEvent?.logicalKey, "checkout.primary");
  assert.ok(typeof failureEvent?.durationMs === "number");
});

test("control flow executes deterministically with scoped context", async () => {
  const scheduler = createDefaultScheduler();
  const iterationOrder: Array<{ item: unknown; index: unknown }> = [];

  const handlers: WorkflowHandlers = {
    log: (args) => {
      if (args.step.message === "record") {
        iterationOrder.push({
          item: args.context.get("item"),
          index: args.context.get("idx")
        });
      }
    },
    setContext: (args) => {
      const step = args.step as SetContextStep;
      if (Object.prototype.hasOwnProperty.call(step, "value")) {
        args.context.set(step.path, step.value);
      }
    }
  } satisfies WorkflowHandlers;

  const definition: WorkflowDefinition = {
    id: "control-flow",
    steps: [
      {
        kind: "if",
        when: { kind: "ctxDefined", path: "ctx.items" },
        then: [
          {
            kind: "foreach",
            list: "ctx.items",
            as: "item",
            indexVar: "idx",
            steps: [
              {
                kind: "log",
                message: "record"
              } satisfies LogStep
            ]
          } satisfies ForeachStep
        ],
        else: [
          {
            kind: "log",
            message: "no-op"
          } satisfies LogStep
        ]
      }
    ]
  };

  const outcome: WorkflowRunOutcome = await runWorkflow(definition, {
    handlers,
    resolver,
    scheduler,
    context: new InMemoryWorkflowContext(),
    initialContext: {
      "ctx.items": ["first", "second"]
    },
    runId: "control-flow-run"
  });

  assert.equal(outcome.status, "success");
  assert.deepEqual(iterationOrder, [
    { item: "first", index: 0 },
    { item: "second", index: 1 }
  ]);
  assert.equal(outcome.completedSteps, 4);
  assert.equal(outcome.contextSnapshot["item"], undefined);
  assert.equal(outcome.contextSnapshot["idx"], undefined);
  assert.deepEqual(outcome.contextSnapshot["ctx.items"], ["first", "second"]);
});
