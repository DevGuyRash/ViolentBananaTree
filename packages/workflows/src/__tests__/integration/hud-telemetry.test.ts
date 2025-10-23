import { test } from "node:test";
import assert from "node:assert/strict";

import {
  runWorkflow,
  type WorkflowResolver,
  type WorkflowResolverRequest
} from "../../engine/runtime";
import { createDefaultScheduler } from "../../engine/scheduler";
import { createWorkflowTelemetry } from "../../telemetry";
import {
  InMemoryWorkflowContext,
  type WorkflowDefinition,
  type WorkflowHandlers
} from "../../types";
import { StepError } from "../../engine/errors";
import type { HudNotification } from "../../../../menu/hud";

const resolver: WorkflowResolver = {
  async resolve(_request: WorkflowResolverRequest) {
    return {
      key: "logical",
      element: {} as unknown as Element,
      attempts: []
    };
  }
};

test("HUD receives workflow lifecycle and step status telemetry", async () => {
  const notifications: HudNotification[] = [];
  const clock = installFakeNow(1_000);

  const bridge = createWorkflowTelemetry({
    hud: {
      notify: (notification) => {
        notifications.push(notification);
      }
    }
  });

  const handlers: WorkflowHandlers = {
    log: () => {
      clock.set(1_600);
    }
  };

  const definition: WorkflowDefinition = {
    id: "hud-success",
    steps: [
      {
        kind: "log",
        message: "start"
      }
    ]
  };

  clock.set(1_000);

  try {
    const outcome = await runWorkflow(definition, {
      handlers,
      scheduler: createDefaultScheduler(),
      resolver,
      telemetry: bridge.adapter,
      context: new InMemoryWorkflowContext(),
      runId: "hud-success-run"
    });

    assert.equal(outcome.status, "success");

    const titles = notifications.map((notification) => notification.title);
    assert.ok(titles.includes("[DGX] Workflow hud-success started"));
    assert.ok(titles.includes("[DGX] Workflow hud-success completed"));
    assert.ok(titles.includes("[DGX] Step pending"));
    assert.ok(titles.includes("[DGX] Step success"));

    const stepSuccess = notifications.find((notification) => notification.title === "[DGX] Step success");
    assert.ok(stepSuccess);
    assert.match(stepSuccess.description, /duration: 600ms/);
    const stepMetadata = stepSuccess.metadata as { status?: string } | undefined;
    assert.equal(stepMetadata?.status, "success");

    const runComplete = notifications.find((notification) => notification.title === "[DGX] Workflow hud-success completed");
    assert.ok(runComplete);
    assert.match(runComplete.description, /duration: 600ms/);
    const runMetadata = runComplete.metadata as { status?: string; workflowId?: string } | undefined;
    assert.equal(runMetadata?.status, "success");
    assert.equal(runMetadata?.workflowId, "hud-success");
  } finally {
    bridge.dispose();
    clock.restore();
  }
});

test("HUD notifications mask sensitive error payloads", async () => {
  const notifications: HudNotification[] = [];
  const clock = installFakeNow(4_000);

  const bridge = createWorkflowTelemetry({
    hud: {
      notify: (notification) => {
        notifications.push(notification);
      }
    }
  });

  const handlers: WorkflowHandlers = {
    type: () => {
      clock.set(4_500);
      throw new StepError({
        reason: "unknown",
        message: "type failed",
        stepKind: "type",
        logicalKey: "input.password",
        data: {
          password: "hunter2",
          nested: {
            token: "abc123"
          }
        }
      });
    }
  };

  const definition: WorkflowDefinition = {
    id: "hud-failure",
    steps: [
      {
        kind: "type",
        key: "form.password",
        text: "secret"
      }
    ]
  };

  clock.set(4_000);

  try {
    const outcome = await runWorkflow(definition, {
      handlers,
      scheduler: createDefaultScheduler(),
      resolver,
      telemetry: bridge.adapter,
      context: new InMemoryWorkflowContext(),
      runId: "hud-failure-run"
    });

    assert.equal(outcome.status, "failed");

    const runFailure = notifications.find((notification) => notification.title === "[DGX] Workflow hud-failure failed");
    assert.ok(runFailure);
    const runMetadata = runFailure.metadata as { status?: string; runId?: string } | undefined;
    assert.equal(runMetadata?.status, "failed");
    assert.equal(runMetadata?.runId, "hud-failure-run");

    const failureNotification = notifications.find((notification) => notification.title === "[DGX] Step failure");
    assert.ok(failureNotification);
    const failureMetadata = failureNotification.metadata as {
      status?: string;
      error?: { data?: Record<string, unknown> };
    } | undefined;
    assert.equal(failureMetadata?.status, "failure");
    assert.equal(failureMetadata?.error?.data?.password, "********");
    const nested = failureMetadata?.error?.data?.nested as { token?: string } | undefined;
    assert.equal(nested?.token, "********");
  } finally {
    bridge.dispose();
    clock.restore();
  }
});

function installFakeNow(initial: number): {
  set(next: number): void;
  advance(delta: number): number;
  restore(): void;
} {
  const originalNow = Date.now;
  let current = initial;

  Date.now = () => current;

  return {
    set(next: number) {
      current = next;
    },
    advance(delta: number) {
      current += delta;
      return current;
    },
    restore() {
      Date.now = originalNow;
    }
  };
}
