import test from "node:test";
import assert from "node:assert/strict";

import { createMutationIdleGate, MutationIdleWindowExceededError } from "../idle-gate";

type ObserverStub = {
  observeCalls: Array<{ target: Node | Document | DocumentFragment | ShadowRoot | Element; options?: MutationObserverInit }>;
  disconnectCalls: number;
  callback: MutationCallback | null;
};

function createObserverStub(): { observer: MutationObserver; stub: ObserverStub } {
  const stub: ObserverStub = {
    observeCalls: [],
    disconnectCalls: 0,
    callback: null
  };

  const observer: MutationObserver = {
    observe(target: Node, options?: MutationObserverInit) {
      stub.observeCalls.push({ target, options });
    },
    disconnect() {
      stub.disconnectCalls += 1;
    },
    takeRecords() {
      return [];
    }
  } as MutationObserver;

  return { observer, stub };
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const fakeRoot = { nodeName: "#document" } as unknown as Document;
const fakeTarget = { nodeName: "DIV" } as unknown as Element;

test("waitForIdle resolves after idle window elapses", async () => {
  const { observer, stub } = createObserverStub();

  const gate = createMutationIdleGate({
    createObserver(callback) {
      stub.callback = callback;
      return observer;
    }
  });

  const result = await gate.waitForIdle({
    idle: { idleMs: 10 },
    root: fakeRoot
  });

  assert.ok(result.durationMs >= 10);
  assert.equal(result.statistics.totalMutations, 0);
  assert.equal(stub.disconnectCalls, 1, "observer should disconnect after completion");
  assert.ok(stub.observeCalls.length >= 1, "observer should observe the provided root");
});

test("waitForIdle resets idle timer on mutation events", async () => {
  const { observer, stub } = createObserverStub();
  const gate = createMutationIdleGate({
    createObserver(callback) {
      stub.callback = callback;
      return observer;
    }
  });

  const waitPromise = gate.waitForIdle({
    idle: { idleMs: 40 },
    root: fakeRoot,
    targets: fakeRoot
  });

  // Ensure promise does not resolve before first mutation callback.
  const raceResult = await Promise.race([
    waitPromise.then(() => "resolved" as const),
    wait(15).then(() => "timeout" as const)
  ]);
  assert.equal(raceResult, "timeout", "idle gate should remain pending before mutation");

  const mutationRecord = {
    type: "childList",
    target: fakeTarget,
    addedNodes: []
  } as unknown as MutationRecord;

  stub.callback?.([mutationRecord], observer);

  const lateRace = await Promise.race([
    waitPromise.then(() => "resolved" as const),
    wait(30).then(() => "timeout" as const)
  ]);
  assert.equal(lateRace, "timeout", "mutation should reset idle timer and keep promise pending");

  const result = await waitPromise;
  assert.ok(result.durationMs >= 40, "idle timer should complete after mutation reset");
  assert.equal(result.statistics.totalMutations, 1, "mutation should be counted");
  assert.equal(stub.disconnectCalls, 1, "observer should disconnect after completion");
});

test("waitForIdle enforces maxWindowMs via MutationIdleWindowExceededError", async () => {
  const { observer, stub } = createObserverStub();
  const gate = createMutationIdleGate({
    createObserver(callback) {
      stub.callback = callback;
      return observer;
    }
  });

  await assert.rejects(async () => {
    await gate.waitForIdle({
      idle: { idleMs: 100, maxWindowMs: 20 },
      root: fakeRoot
    });
  }, (error: unknown) => {
    assert.ok(error instanceof MutationIdleWindowExceededError);
    assert.equal(error.code, "idle-window-exceeded");
    return true;
  });
});
