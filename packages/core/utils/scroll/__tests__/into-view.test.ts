import test from "node:test";
import assert from "node:assert/strict";

import {
  createIntoViewScroller,
  type IntoViewTelemetryAdjustmentEvent,
  type IntoViewTelemetrySettleEvent
} from "../into-view";

type FakeElement = Element & {
  nodeType: 1;
  getBoundingClientRect(): DOMRect;
};

type FakeContainer = FakeElement & {
  scrollLeft: number;
  scrollTop: number;
  scrollWidth: number;
  scrollHeight: number;
  clientWidth: number;
  clientHeight: number;
  scroll?(x: number, y: number): void;
  scrollTo?(x: number, y: number): void;
};

const immediateFrame = (cb: (time: number) => void): number => {
  cb(0);
  return 0;
};

const createRect = ({
  top,
  left,
  width,
  height
}: {
  top: number;
  left: number;
  width: number;
  height: number;
}): DOMRect => {
  const bottom = top + height;
  const right = left + width;
  return {
    top,
    left,
    bottom,
    right,
    width,
    height,
    x: left,
    y: top,
    toJSON() {
      return { top, left, bottom, right, width, height };
    }
  } as DOMRect;
};

function createContainer(config: {
  width: number;
  height: number;
  scrollWidth: number;
  scrollHeight: number;
}): FakeContainer {
  let scrollLeft = 0;
  let scrollTop = 0;

  const rect = createRect({ top: 0, left: 0, width: config.width, height: config.height });

  const container: FakeContainer = {
    nodeType: 1,
    scrollLeft,
    scrollTop,
    scrollWidth: config.scrollWidth,
    scrollHeight: config.scrollHeight,
    clientWidth: config.width,
    clientHeight: config.height,
    getBoundingClientRect() {
      return rect;
    },
    scroll(x: number, y: number) {
      this.scrollLeft = x;
      this.scrollTop = y;
    },
    scrollTo(x: number, y: number) {
      this.scrollLeft = x;
      this.scrollTop = y;
    }
  } as unknown as FakeContainer;

  Object.defineProperty(container, "scrollLeft", {
    get() {
      return scrollLeft;
    },
    set(value: number) {
      scrollLeft = value;
    },
    configurable: true
  });

  Object.defineProperty(container, "scrollTop", {
    get() {
      return scrollTop;
    },
    set(value: number) {
      scrollTop = value;
    },
    configurable: true
  });

  return container;
}

function createTarget(container: FakeContainer, config: {
  top: number;
  left: number;
  width: number;
  height: number;
}): FakeElement {
  const state = config;

  const target: FakeElement = {
    nodeType: 1,
    getBoundingClientRect() {
      const top = state.top - container.scrollTop;
      const left = state.left - container.scrollLeft;
      return createRect({ top, left, width: state.width, height: state.height });
    }
  } as unknown as FakeElement;

  Object.defineProperty(target, "__state", {
    value: state,
    enumerable: false,
    writable: false
  });

  return target;
}

test("aligns target to start with margin and succeeds", async () => {
  const container = createContainer({
    width: 220,
    height: 200,
    scrollWidth: 220,
    scrollHeight: 1000
  });

  const target = createTarget(container, {
    top: 520,
    left: 0,
    width: 120,
    height: 40
  });

  const scroller = createIntoViewScroller({ requestAnimationFrame: immediateFrame });

  const result = await scroller.scrollIntoView(target, {
    container,
    alignment: { block: "start" },
    margin: { top: 12, bottom: 16 }
  });

  assert.equal(result.success, true);
  assert.equal(result.attempts, 1);
  assert.equal(container.scrollTop, 508);

  const rect = target.getBoundingClientRect();
  assert.ok(rect.top >= 12 - 0.5 && rect.top <= 12 + 0.5);
  assert.ok(rect.bottom <= 200 - 16 + 0.5);
});

test("clamps horizontal scroll and centers target", async () => {
  const container = createContainer({
    width: 300,
    height: 180,
    scrollWidth: 900,
    scrollHeight: 400
  });

  const target = createTarget(container, {
    top: 60,
    left: 640,
    width: 120,
    height: 60
  });

  const scroller = createIntoViewScroller({ requestAnimationFrame: immediateFrame });

  const result = await scroller.scrollIntoView(target, {
    container,
    alignment: { inline: "center", block: "nearest" },
    margin: { left: 20, right: 20 }
  });

  assert.equal(result.success, true);
  assert.equal(result.attempts, 1);

  const maxLeft = container.scrollWidth - container.clientWidth;
  assert.equal(container.scrollLeft, 550);
  assert.ok(container.scrollLeft <= maxLeft);

  const rect = target.getBoundingClientRect();
  assert.ok(rect.left >= -20 - 0.5 && rect.right <= container.clientWidth - 20 + 0.5);
});

test("honors retry cap and emits telemetry", async () => {
  const container = createContainer({
    width: 200,
    height: 150,
    scrollWidth: 200,
    scrollHeight: 900
  });

  const targetState = { top: 300, left: 0, width: 160, height: 120 };
  const target = createTarget(container, targetState);

  let shifts = 0;

  let scrollTopValue = 0;

  Object.defineProperty(container, "scrollTop", {
    get() {
      return scrollTopValue;
    },
    set(value: number) {
      scrollTopValue = value;
      shifts += 1;
      targetState.top += 60; // keep element drifting downward
    },
    configurable: true
  });

  const adjustments: IntoViewTelemetryAdjustmentEvent[] = [];
  let settleEvent: IntoViewTelemetrySettleEvent | null = null;

  const scroller = createIntoViewScroller({ requestAnimationFrame: immediateFrame });

  const result = await scroller.scrollIntoView(target, {
    container,
    alignment: { block: "start" },
    margin: { top: 0, bottom: 0 },
    maxRetries: 2,
    telemetry: {
      onAdjustment(event) {
        adjustments.push(event);
      },
      onSettle(event) {
        settleEvent = event;
      }
    }
  });

  assert.equal(result.success, false);
  assert.equal(result.reason, "max-retries");
  assert.equal(result.attempts, 2);
  assert.equal(shifts, 2);
  assert.equal(adjustments.length, 2);
  assert.ok(settleEvent);
  assert.equal(settleEvent?.success, false);
  assert.equal(settleEvent?.attempts, 2);
});
