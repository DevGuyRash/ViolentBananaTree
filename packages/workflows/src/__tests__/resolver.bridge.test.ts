import { test } from "node:test";
import assert from "node:assert/strict";

import { createWorkflowResolverBridge } from "../engine/resolver";
import { StepError } from "../engine/errors";
import type { WorkflowResolverRequest } from "../engine/runtime";
import { InMemoryWorkflowContext } from "../types";
import type { SelectorMap } from "../../../selectors/types";

const selectorMap: SelectorMap = {
  action_button: {
    tries: [],
    description: "Mock entry"
  }
};

function createRequest(attempt = 1): WorkflowResolverRequest {
  return {
    runId: "run-test",
    workflowId: "wf-test",
    step: { kind: "waitFor", key: "action_button" } as WorkflowResolverRequest["step"],
    attempt,
    signal: new AbortController().signal,
    context: new InMemoryWorkflowContext(),
    logger: {}
  };
}

test("resolver bridge caches results per attempt", async () => {
  let delegateCalls = 0;
  const resolver = createWorkflowResolverBridge({
    selectorMap,
    resolve: async () => {
      delegateCalls += 1;
      return {
        key: "action_button",
        element: null,
        attempts: []
      };
    }
  });

  const request = createRequest();

  await resolver.resolve(request);
  await resolver.resolve(request);

  assert.equal(delegateCalls, 1);
});

test("resolver bridge logs successes and misses", async () => {
  const logs: Array<{ level: string; data: Record<string, unknown> }> = [];
  const logger = {
    info: (_message: string, data?: Record<string, unknown>) => {
      logs.push({ level: "info", data: data ?? {} });
    },
    warn: (_message: string, data?: Record<string, unknown>) => {
      logs.push({ level: "warn", data: data ?? {} });
    },
    debug: () => {}
  };

  const element = { tagName: "BUTTON" } as unknown as Element;

  const resolver = createWorkflowResolverBridge({
    selectorMap,
    resolve: async () => ({
      key: "action_button",
      element,
      attempts: [
        {
          strategy: { type: "css", selector: "button" } as any,
          success: true,
          elements: [element]
        }
      ]
    })
  });

  await resolver.resolve({ ...createRequest(), logger });

  assert.ok(logs.some((entry) => entry.level === "info"));

  logs.length = 0;

  const missResolver = createWorkflowResolverBridge({
    selectorMap,
    resolve: async () => ({
      key: "action_button",
      element: null,
      attempts: []
    })
  });

  await missResolver.resolve({ ...createRequest(), logger });

  assert.ok(logs.some((entry) => entry.level === "warn"));
});

test("resolver bridge honors abort signals", async () => {
  const controller = new AbortController();
  const resolver = createWorkflowResolverBridge({ selectorMap });
  const request = createRequest();
  request.signal = controller.signal;

  controller.abort();

  await assert.rejects(resolver.resolve(request), (error) => {
    assert.ok(error instanceof StepError);
    assert.equal(error.reason, "cancelled");
    return true;
  });
});

test("resolver bridge wraps delegate errors", async () => {
  const resolver = createWorkflowResolverBridge({
    selectorMap,
    resolve: async () => {
      throw new Error("delegate failure");
    }
  });

  await assert.rejects(resolver.resolve(createRequest()), (error) => {
    assert.ok(error instanceof StepError);
    assert.equal(error.reason, "resolver-miss");
    return true;
  });
});
