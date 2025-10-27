import test from "node:test";
import assert from "node:assert/strict";

import {
  createScrollContainerDetector,
  type ScrollContainerTelemetryEvent,
  type ScrollContainerStrategyStep
} from "../container";

type FakeElementConfig = {
  id?: string;
  overflow?: string;
  overflowX?: string;
  overflowY?: string;
  scrollHeight?: number;
  clientHeight?: number;
  scrollWidth?: number;
  clientWidth?: number;
  parent?: FakeElement;
  attributes?: Record<string, string>;
};

type FakeElement = Element & {
  __config: FakeElementConfig;
  nodeType: 1;
  parentElement: FakeElement | null;
  ownerDocument?: FakeDocument | null;
  getAttribute(name: string): string | null;
};

type FakeDocument = Document & {
  __elements: Map<string, FakeElement>;
  querySelector(selector: string): FakeElement | null;
  getElementById(id: string): FakeElement | null;
  scrollingElement?: FakeElement | null;
  body?: FakeElement | null;
  documentElement?: FakeElement | null;
};

const createStyle = (values: Partial<Record<string, string>>): CSSStyleDeclaration => {
  return values as unknown as CSSStyleDeclaration;
};

function createFakeDocument(): FakeDocument {
  const elements = new Map<string, FakeElement>();

  const doc: FakeDocument = {
    __elements: elements,
    nodeType: 9,
    querySelector(selector: string): FakeElement | null {
      if (selector.startsWith("#")) {
        return elements.get(selector.slice(1)) ?? null;
      }
      return null;
    },
    getElementById(id: string): FakeElement | null {
      return elements.get(id) ?? null;
    }
  } as unknown as FakeDocument;

  return doc;
}

function createFakeElement(config: FakeElementConfig = {}, doc?: FakeDocument): FakeElement {
  const element: FakeElement = {
    nodeType: 1,
    parentElement: null,
    ownerDocument: doc ?? null,
    __config: config,
    getAttribute(name: string): string | null {
      return config.attributes?.[name] ?? null;
    }
  } as unknown as FakeElement;

  if (typeof config.scrollHeight === "number") {
    (element as { scrollHeight?: number }).scrollHeight = config.scrollHeight;
  }

  if (typeof config.clientHeight === "number") {
    (element as { clientHeight?: number }).clientHeight = config.clientHeight;
  }

  if (typeof config.scrollWidth === "number") {
    (element as { scrollWidth?: number }).scrollWidth = config.scrollWidth;
  }

  if (typeof config.clientWidth === "number") {
    (element as { clientWidth?: number }).clientWidth = config.clientWidth;
  }

  if (doc && config.id) {
    doc.__elements.set(config.id, element);
  }

  if (config.parent) {
    element.parentElement = config.parent;
  }

  return element;
}

const buildStyleMap = (...pairs: Array<[Element, CSSStyleDeclaration]>): Map<Element, CSSStyleDeclaration> => {
  return new Map(pairs);
};

const getStyleFromMap = (styles: Map<Element, CSSStyleDeclaration>) => (element: Element): CSSStyleDeclaration | null => {
  return styles.get(element) ?? null;
};

const extractStepKinds = (history: ScrollContainerStrategyStep[]): string[] => history.map((step) => step.kind);

test("detects nearest ancestor with scrollable overflow", () => {
  const doc = createFakeDocument();
  const container = createFakeElement(
    {
      id: "list",
      overflowY: "auto",
      scrollHeight: 600,
      clientHeight: 200
    },
    doc
  );

  const target = createFakeElement(
    {
      parent: container,
      scrollHeight: 150,
      clientHeight: 150
    },
    doc
  );

  const styles = buildStyleMap(
    [container, createStyle({ overflowY: "auto" })],
    [target, createStyle({ overflowY: "visible" })]
  );

  const detector = createScrollContainerDetector({
    document: doc,
    getComputedStyle: getStyleFromMap(styles)
  });

  const result = detector.detect(target);

  assert.equal(result.element, container);
  assert.equal(result.strategy?.kind, "ancestor-overflow");
  assert.equal(result.fallbackApplied, false);
  assert.equal(result.strategyHistory.length > 0, true);
  assert.ok(result.summaries.some((summary) => summary.includes("ancestor-overflow|accepted")));
});

test("resolves container via DGX hint attribute", () => {
  const doc = createFakeDocument();

  const hintTarget = createFakeElement({ attributes: { "data-dgx-scroller": "#scroll-root" } }, doc);

  const hintedContainer = createFakeElement(
    {
      id: "scroll-root",
      overflowY: "scroll",
      scrollHeight: 500,
      clientHeight: 250
    },
    doc
  );

  const styles = buildStyleMap(
    [hintTarget, createStyle({ overflowY: "visible" })],
    [hintedContainer, createStyle({ overflowY: "scroll" })]
  );

  doc.body = hintedContainer;

  const detector = createScrollContainerDetector({
    document: doc,
    getComputedStyle: getStyleFromMap(styles)
  });

  const result = detector.detect(hintTarget);

  assert.equal(result.element, hintedContainer);
  assert.equal(result.strategy?.kind, "hint-attribute");
  assert.equal(result.fallbackApplied, false);
  assert.ok(result.hintsTried.includes("data-dgx-scroller"));
  assert.ok(extractStepKinds(result.strategyHistory).includes("hint-attribute"));
});

test("uses context fallback keys when hints fail", () => {
  const doc = createFakeDocument();
  const target = createFakeElement({}, doc);

  const contextContainer = createFakeElement(
    {
      id: "ctx",
      overflowY: "auto",
      scrollHeight: 700,
      clientHeight: 300
    },
    doc
  );

  const styles = buildStyleMap(
    [contextContainer, createStyle({ overflowY: "auto" })],
    [target, createStyle({ overflowY: "visible" })]
  );

  const detector = createScrollContainerDetector({
    document: doc,
    getComputedStyle: getStyleFromMap(styles)
  });

  const result = detector.detect(target, {
    context: {
      fallbackKeys: ["ctx"],
      resolveKey: (key) => (key === "ctx" ? contextContainer : null)
    }
  });

  assert.equal(result.element, contextContainer);
  assert.equal(result.strategy?.kind, "context-key");
  assert.equal(result.fallbackApplied, false);
  assert.ok(result.strategyHistory.some((step) => step.kind === "context-key" && step.accepted));
});

test("falls back to document scrolling element and emits telemetry", () => {
  const doc = createFakeDocument();

  const scrollingElement = createFakeElement(
    {
      id: "document-scroller",
      overflowY: "auto",
      scrollHeight: 1000,
      clientHeight: 600
    },
    doc
  );

  doc.scrollingElement = scrollingElement;

  const styles = buildStyleMap([scrollingElement, createStyle({ overflowY: "auto" })]);

  const events: ScrollContainerTelemetryEvent[] = [];

  const detector = createScrollContainerDetector({
    document: doc,
    getComputedStyle: getStyleFromMap(styles),
    telemetry: {
      emit(event) {
        events.push(event);
      }
    }
  });

  const result = detector.detect(null);

  assert.equal(result.element, scrollingElement);
  assert.equal(result.strategy?.kind, "document");
  assert.equal(result.fallbackApplied, true);
  assert.ok(events.some((event) => event.kind === "fallback" && event.strategy === "document"));
  assert.ok(result.summaries.some((summary) => summary.startsWith("document|accepted")));
});
