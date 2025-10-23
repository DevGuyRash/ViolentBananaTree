import { test } from "node:test";
import assert from "node:assert/strict";

import { createClickHandler } from "../actions/click";
import { createWaitForHandler } from "../actions/waitFor";
import { createCaptureHandler } from "../actions/capture";
import type { ActionExecutionArgs } from "../actions/shared";
import {
  InMemoryWorkflowContext,
  type WorkflowStepExecutionArgs,
  type ClickStep,
  type WaitForStep,
  type CaptureStep
} from "../types";
import { StepError } from "../engine/errors";

class TestHTMLElement extends EventTarget {
  dispatched: string[] = [];
  focused = false;
  textContent = "";

  dispatchEvent(event: Event): boolean {
    this.dispatched.push(event.type);
    return super.dispatchEvent(event);
  }

  focus(): void {
    this.focused = true;
  }
}

class TestMouseEvent extends Event {
  readonly detail: number;
  readonly button: number;
  constructor(type: string, init: MouseEventInit = {}) {
    super(type, init);
    this.detail = init.detail ?? 0;
    this.button = init.button ?? 0;
  }
}

const originalHTMLElement = globalThis.HTMLElement;
const originalMouseEvent = globalThis.MouseEvent;

test.before(() => {
  // @ts-expect-error -- assigning test doubles for DOM constructors in Node environment
  globalThis.HTMLElement = TestHTMLElement;
  // @ts-expect-error -- assigning test doubles for DOM constructors in Node environment
  globalThis.MouseEvent = TestMouseEvent;
});

test.after(() => {
  if (originalHTMLElement) {
    // @ts-expect-error restoring potential DOM constructor
    globalThis.HTMLElement = originalHTMLElement;
  } else {
    // @ts-expect-error cleanup when original constructor absent
    delete globalThis.HTMLElement;
  }

  if (originalMouseEvent) {
    // @ts-expect-error restoring potential DOM constructor
    globalThis.MouseEvent = originalMouseEvent;
  } else {
    // @ts-expect-error cleanup when original constructor absent
    delete globalThis.MouseEvent;
  }
});

function baseArgs<TStep extends WorkflowStepExecutionArgs["step"]>(step: TStep): WorkflowStepExecutionArgs {
  const controller = new AbortController();
  return {
    step,
    attempt: 1,
    retriesRemaining: 0,
    context: new InMemoryWorkflowContext(),
    resolveResult: null,
    runId: "run-test",
    workflowId: "wf-test",
    logger: {},
    signal: controller.signal,
    resolveLogicalKey: async () => ({ key: "logical", element: null, attempts: [] })
  } satisfies WorkflowStepExecutionArgs;
}

test("click handler dispatches mouse events and focuses element", async () => {
  const handler = createClickHandler();
  const element = new TestHTMLElement();
  const args = baseArgs<ClickStep>({
    kind: "click",
    key: "main.button"
  });

  (args as ActionExecutionArgs<ClickStep>).resolveResult = {
    key: "main.button",
    element,
    attempts: []
  };

  const result = await handler(args as ActionExecutionArgs<ClickStep>);

  assert.equal(result?.status, "success");
  assert.deepEqual(element.dispatched, ["pointerdown", "mousedown", "mouseup", "click"]);
  assert.equal(element.focused, true);
});

test("click handler throws resolver-miss when element absent", async () => {
  const handler = createClickHandler();
  const args = baseArgs<ClickStep>({
    kind: "click",
    key: "missing.button"
  });

  await assert.rejects(handler(args as ActionExecutionArgs<ClickStep>), (error: unknown) => {
    assert.ok(error instanceof StepError);
    assert.equal(error.reason, "resolver-miss");
    return true;
  });
});

test("waitFor handler resolves when predicate succeeds", async () => {
  const handler = createWaitForHandler();
  const element = new TestHTMLElement();
  element.textContent = "Submit";

  const args = baseArgs<WaitForStep>({
    kind: "waitFor",
    key: "cta",
    text: "Submit"
  });

  (args as ActionExecutionArgs<WaitForStep>).resolveResult = {
    key: "cta",
    element,
    attempts: []
  };

  const result = await handler(args as ActionExecutionArgs<WaitForStep>);

  assert.equal(result?.status, "success");
});

test("waitFor handler throws timeout when predicate fails", async () => {
  const handler = createWaitForHandler();
  const args = baseArgs<WaitForStep>({
    kind: "waitFor",
    key: "cta",
    timeoutMs: 0,
    text: "Confirm"
  });

  const element = new TestHTMLElement();
  element.textContent = "Cancel";

  (args as ActionExecutionArgs<WaitForStep>).resolveResult = {
    key: "cta",
    element,
    attempts: []
  };

  await assert.rejects(handler(args as ActionExecutionArgs<WaitForStep>), (error: unknown) => {
    assert.ok(error instanceof StepError);
    assert.equal(error.reason, "timeout");
    return true;
  });
});

test("capture handler masks sensitive values when sanitize is enabled", async () => {
  const handler = createCaptureHandler();
  const element = new TestHTMLElement();
  element.textContent = "super-secret";

  const args = baseArgs<CaptureStep>({
    kind: "capture",
    to: "ctx.secret",
    from: { kind: "text", key: "secret" },
    sanitize: true
  });

  (args as ActionExecutionArgs<CaptureStep>).resolveLogicalKey = async () => ({
    key: "secret",
    element,
    attempts: []
  });

  const result = await handler(args as ActionExecutionArgs<CaptureStep>);

  assert.equal(result?.status, "success");
  assert.ok(result?.contextUpdates);
  assert.equal(result?.contextUpdates?.[0]?.value, "********");
  assert.equal(result?.data?.value, "********");
});
