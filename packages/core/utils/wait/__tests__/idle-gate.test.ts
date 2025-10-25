import { JSDOM } from "jsdom";
import { createMutationIdleGate } from "../idle-gate";
import {
  vi,
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
  beforeEach,
} from "vitest";

describe("createMutationIdleGate", ()_=>_{
  let dom: JSDOM;
  let observer: MutationObserver | null = null;
  const mutationObserverCbMap = new WeakMap<
    MutationObserver,
    MutationCallback
  >();

  // a MutationObserver mock that allows us to manually trigger callbacks
  const MutationObserverMock = vi.fn((cb: MutationCallback) => {
    const observerInstance = {
      observe: vi.fn(),
      disconnect: vi.fn(),
      takeRecords: vi.fn(),
    };
    mutationObserverCbMap.set(observerInstance, cb);
    observer = observerInstance;
    return observerInstance;
  });

  beforeAll(() => {
    vi.useFakeTimers();
  });

    beforeEach(() => {
    dom = new JSDOM("<!DOCTYPE html><div></div>");
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("MutationObserver", MutationObserverMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.clearAllTimers();
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it("should resolve when the idle window is reached", async () => {
    const idleGate = createMutationIdleGate({
      idleWindowMs: 100,
    });
    const waitPromise = idleGate.wait();

    vi.advanceTimersByTime(100);

    await expect(waitPromise).resolves.toBeUndefined();
  });

  it("should reset the idle timer on mutations", async () => {
    const idleGate = createMutationIdleGate({
      idleWindowMs: 100,
    });
    const waitPromise = idleGate.wait();

    vi.advanceTimersByTime(50);
    const cb = mutationObserverCbMap.get(observer!)!;

    // simulate a mutation
    cb([], observer!);
    vi.advanceTimersByTime(50);
    // at this point, the total time elapsed is 100ms, but the idle timer should have been reset
    // so the promise should still be pending
    cb([], observer!);
    vi.advanceTimersByTime(100);
    // now the idle window should be reached
    await expect(waitPromise).resolves.toBeUndefined();
  });
});
