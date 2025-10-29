import { test } from "node:test";
import assert from "node:assert/strict";

import { createClickHandler } from "../actions/click";
import { createWaitForHandler } from "../actions/waitFor";
import { createWaitVisibleHandler } from "../actions/waitVisible";
import { createCaptureHandler } from "../actions/capture";
import { createCollectListHandler } from "../actions/collectList";
import type { ActionExecutionArgs } from "../actions/shared";
import {
  InMemoryWorkflowContext,
  type WorkflowStepExecutionArgs,
  type ClickStep,
  type WaitForStep,
  type WaitVisibleStep,
  type CaptureStep,
  type CollectListStep
} from "../types";
import type { ResolveResult } from "../../../core/resolve";
import type { SelectorTry } from "../../../selectors/types";
import { StepError } from "../engine/errors";
import { DEFAULT_WAIT_INTERVAL_MS, DEFAULT_WAIT_TIMEOUT_MS } from "../../../core/utils/wait";

class TestHTMLElement extends EventTarget {
  dispatched: string[] = [];
  focused = false;
  textContent = "";
  isConnected = true;
  nodeType = 1;

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
const originalElement = globalThis.Element;

class TestListElement extends TestHTMLElement {
  #children: TestListElement[] = [];
  parentElement: TestListElement | null = null;
  #attributes = new Map<string, string>();

  constructor(text = "", attrs: Record<string, string> = {}) {
    super();
    this.textContent = text;
    Object.entries(attrs).forEach(([name, value]) => {
      this.#attributes.set(name, value);
    });
  }

  appendChild(child: TestListElement): void {
    child.parentElement = this;
    this.#children.push(child);
  }

  get children(): TestListElement[] {
    return this.#children;
  }

  contains(node: EventTarget | null): boolean {
    if (!node || !(node instanceof TestListElement)) {
      return false;
    }

    if (node === this) {
      return true;
    }

    return this.#children.some((child) => child.contains(node));
  }

  setAttribute(name: string, value: string): void {
    this.#attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.#attributes.has(name) ? this.#attributes.get(name)! : null;
  }

  get attributes(): Array<{ name: string; value: string }> {
    return Array.from(this.#attributes.entries()).map(([name, value]) => ({ name, value }));
  }
}

test.before(() => {
  globalThis.HTMLElement = TestHTMLElement as unknown as typeof globalThis.HTMLElement;
  globalThis.MouseEvent = TestMouseEvent as unknown as typeof globalThis.MouseEvent;
  globalThis.Element = TestHTMLElement as unknown as typeof globalThis.Element;
});

test.after(() => {
  if (originalHTMLElement) {
    globalThis.HTMLElement = originalHTMLElement;
  } else {
    delete (globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement;
  }

  if (originalMouseEvent) {
    globalThis.MouseEvent = originalMouseEvent;
  } else {
    delete (globalThis as { MouseEvent?: typeof MouseEvent }).MouseEvent;
  }

  if (originalElement) {
    globalThis.Element = originalElement;
  } else {
    delete (globalThis as { Element?: typeof Element }).Element;
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
    resolveLogicalKey: async (key: string) => {
      if (key === step.key) {
        const element = (step as { _testElement?: Element })._testElement ?? null;
        const attempts = element
          ? [{ strategy: { type: "text", text: "Submit" }, success: true, elements: [element] }]
          : [];
        return {
          key,
          element,
          attempts,
          resolvedBy: attempts[0]?.strategy
        } satisfies ResolveResult;
      }

      return { key, element: null, attempts: [] } satisfies ResolveResult;
    }
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
    element: element as unknown as Element,
    attempts: []
  } satisfies ResolveResult;
  (args as WorkflowStepExecutionArgs & { step: ClickStep }).step._testElement = element as unknown as Element;

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

  await assert.rejects(async () => {
    await handler(args as ActionExecutionArgs<ClickStep>);
  }, (error: unknown) => {
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
    element: element as unknown as Element,
    attempts: []
  } satisfies ResolveResult;
  (args as WorkflowStepExecutionArgs & { step: WaitForStep }).step._testElement = element as unknown as Element;

  const result = await handler(args as ActionExecutionArgs<WaitForStep>);

  assert.equal(result?.status, "success");
  const waitPayload = result?.data?.wait as {
    metadata?: { timeoutMs?: number; intervalMs?: number };
    guidance?: string;
  };
  assert.ok(waitPayload);
  assert.equal(waitPayload?.metadata?.timeoutMs, DEFAULT_WAIT_TIMEOUT_MS);
  assert.equal(waitPayload?.metadata?.intervalMs, DEFAULT_WAIT_INTERVAL_MS);
  assert.ok(typeof waitPayload?.guidance === "string" && (waitPayload?.guidance ?? "").length > 0);
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
    element: element as unknown as Element,
    attempts: []
  } satisfies ResolveResult;
  (args as WorkflowStepExecutionArgs & { step: WaitForStep }).step._testElement = element as unknown as Element;

  await assert.rejects(async () => {
    await handler(args as ActionExecutionArgs<WaitForStep>);
  }, (error: unknown) => {
    assert.ok(error instanceof StepError);
    assert.equal(error.reason, "timeout");
    const payload = error.data?.wait as {
      metadata?: { timeoutMs?: number };
      guidance?: string;
    } | undefined;
    assert.ok(payload?.metadata?.timeoutMs === 0 || payload?.metadata?.timeoutMs === DEFAULT_WAIT_TIMEOUT_MS);
    assert.ok(typeof payload?.guidance === "string" && (payload?.guidance ?? "").length > 0);
    return true;
  });
});

test("collectList handler uses itemKey and mapper function", async () => {
  const handler = createCollectListHandler();

  const parent = new TestListElement();
  const first = new TestListElement("Alpha", { "data-id": "one" });
  const second = new TestListElement("Beta", { "data-id": "two" });
  parent.appendChild(first);
  parent.appendChild(second);

  const step: CollectListStep = {
    kind: "collectList",
    options: {
      parentKey: "list.container",
      itemKey: "list.item",
      map: (element, { index }) => ({
        index,
        text: element.textContent,
        id: element.getAttribute("data-id")
      })
    },
    toCtx: "list.items"
  };

  const itemStrategy: SelectorTry = { type: "css", selector: ".item" } as SelectorTry;

  const controller = new AbortController();
  const args: WorkflowStepExecutionArgs = {
    step,
    attempt: 1,
    retriesRemaining: 0,
    context: new InMemoryWorkflowContext(),
    resolveResult: null,
    runId: "run-test",
    workflowId: "wf-test",
    logger: {},
    signal: controller.signal,
    resolveLogicalKey: async (key: string) => {
      if (key === "list.container") {
        return {
          key,
          element: parent as unknown as Element,
          attempts: []
        } satisfies ResolveResult;
      }

      if (key === "list.item") {
        return {
          key,
          element: first as unknown as Element,
          attempts: [
            {
              strategy: itemStrategy,
              success: true,
              elements: [first as unknown as Element, second as unknown as Element]
            }
          ],
          resolvedBy: itemStrategy
        } satisfies ResolveResult;
      }

      return { key, element: null, attempts: [] } satisfies ResolveResult;
    }
  } satisfies WorkflowStepExecutionArgs;

  const result = await handler(args as ActionExecutionArgs<CollectListStep>);

  assert.equal(result?.status, "success");
  assert.deepEqual(result?.data?.values, [
    { index: 0, text: "Alpha", id: "one" },
    { index: 1, text: "Beta", id: "two" }
  ]);

  assert.equal(result?.contextUpdates?.[0]?.path, "list.items");
  assert.deepEqual(result?.contextUpdates?.[0]?.value, [
    { index: 0, text: "Alpha", id: "one" },
    { index: 1, text: "Beta", id: "two" }
  ]);
});

test("collectList handler falls back to serialization when mapper yields undefined", async () => {
  const handler = createCollectListHandler();

  const parent = new TestListElement();
  const first = new TestListElement("Alpha");
  const second = new TestListElement("Beta");
  parent.appendChild(first);
  parent.appendChild(second);

  const step: CollectListStep = {
    kind: "collectList",
    options: {
      parentKey: "list.container",
      itemKey: "list.item",
      mapCtx: "list.mapper"
    }
  };

  const itemStrategy: SelectorTry = { type: "css", selector: ".item" } as SelectorTry;

  const controller = new AbortController();
  const context = new InMemoryWorkflowContext({
    "list.mapper": (element: TestListElement, { index }: { index: number }) => {
      if (index === 0) {
        return { headline: element.textContent };
      }
      return undefined;
    }
  });

  const args: WorkflowStepExecutionArgs = {
    step,
    attempt: 1,
    retriesRemaining: 0,
    context,
    resolveResult: null,
    runId: "run-test",
    workflowId: "wf-test",
    logger: {},
    signal: controller.signal,
    resolveLogicalKey: async (key: string) => {
      if (key === "list.container") {
        return {
          key,
          element: parent as unknown as Element,
          attempts: []
        } satisfies ResolveResult;
      }

      if (key === "list.item") {
        return {
          key,
          element: first as unknown as Element,
          attempts: [
            {
              strategy: itemStrategy,
              success: true,
              elements: [first as unknown as Element, second as unknown as Element]
            }
          ],
          resolvedBy: itemStrategy
        } satisfies ResolveResult;
      }

      return { key, element: null, attempts: [] } satisfies ResolveResult;
    }
  } satisfies WorkflowStepExecutionArgs;

  const result = await handler(args as ActionExecutionArgs<CollectListStep>);

  assert.equal(result?.status, "success");
  assert.deepEqual(result?.data?.values, [
    { headline: "Alpha" },
    "Beta"
  ]);
});

test("waitVisible handler records metadata", async () => {
  const handler = createWaitVisibleHandler();
  const element = new TestHTMLElement();
  element.textContent = "Ready";

  const args = baseArgs<WaitVisibleStep>({
    kind: "waitVisible",
    key: "status.banner"
  });

  (args as ActionExecutionArgs<WaitVisibleStep>).resolveResult = {
    key: "status.banner",
    element: element as unknown as Element,
    attempts: []
  } satisfies ResolveResult;
  (args as WorkflowStepExecutionArgs & { step: WaitVisibleStep }).step._testElement = element as unknown as Element;

  const result = await handler(args as ActionExecutionArgs<WaitVisibleStep>);

  assert.equal(result?.status, "success");
  const waitPayload = result?.data?.wait as {
    metadata?: { timeoutMs?: number };
    guidance?: string;
  };
  assert.ok(waitPayload?.metadata?.timeoutMs === DEFAULT_WAIT_TIMEOUT_MS);
  assert.ok(typeof waitPayload?.guidance === "string" && (waitPayload?.guidance ?? "").length > 0);
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

  (args as ActionExecutionArgs<CaptureStep>).resolveLogicalKey = async () =>
    ({
      key: "secret",
      element: element as unknown as Element,
      attempts: []
    } satisfies ResolveResult);

  const result = await handler(args as ActionExecutionArgs<CaptureStep>);

  assert.equal(result?.status, "success");
  assert.ok(result?.contextUpdates);
  assert.equal(result?.contextUpdates?.[0]?.value, "********");
  assert.equal(result?.data?.value, "********");
});
