const SCROLLABLE_OVERFLOW_VALUES = new Set(["auto", "scroll", "overlay"]);

const DEFAULT_HINT_ATTRIBUTES = [
  "data-dgx-scroller",
  "data-dgx-scroll-root",
  "data-dgx-scroll-container"
];

export type ScrollContainerStrategyKind =
  | "ancestor-overflow"
  | "hint-attribute"
  | "context-element"
  | "context-key"
  | "document"
  | "document-body"
  | "none";

export interface ScrollContainerStrategyStep {
  kind: ScrollContainerStrategyKind;
  accepted: boolean;
  reason?: string;
  element?: Element | null;
  source?: string;
}

export interface ScrollContainerTelemetryEvent {
  kind: "candidate" | "resolved" | "fallback";
  strategy: ScrollContainerStrategyKind;
  accepted?: boolean;
  reason?: string;
  source?: string;
  fallback?: boolean;
  history?: ReadonlyArray<ScrollContainerStrategyStep>;
}

export interface ScrollContainerTelemetry {
  emit(event: ScrollContainerTelemetryEvent): void;
}

export interface ScrollContainerHintOptions {
  attributeNames?: string[];
  resolve?: (value: string, origin: Element) => Element | null | undefined;
}

export interface ScrollContainerContextOptions {
  fallbackElements?: Array<Element | null | undefined>;
  fallbackKeys?: string[];
  resolveKey?: (key: string) => Element | null | undefined;
}

export interface ScrollContainerDetectionOptions {
  root?: Document | DocumentFragment | ShadowRoot | Element | null;
  hints?: ScrollContainerHintOptions;
  context?: ScrollContainerContextOptions;
}

export interface ScrollContainerDetectorDependencies {
  document?: Document | null;
  getComputedStyle?: (element: Element) => CSSStyleDeclaration | null;
  telemetry?: ScrollContainerTelemetry | null;
  logger?: {
    debug?(message: string, data?: Record<string, unknown>): void;
    info?(message: string, data?: Record<string, unknown>): void;
    warn?(message: string, data?: Record<string, unknown>): void;
  } | null;
  hintAttributes?: string[];
}

export interface ScrollContainerResolution {
  element: Element | null;
  strategy: ScrollContainerStrategyStep | null;
  strategyHistory: ScrollContainerStrategyStep[];
  hintsTried: string[];
  fallbackApplied: boolean;
  summaries: string[];
}

export interface ScrollContainerDetector {
  detect(target: Element | null | undefined, options?: ScrollContainerDetectionOptions): ScrollContainerResolution;
}

export function createScrollContainerDetector(
  dependencies: ScrollContainerDetectorDependencies = {}
): ScrollContainerDetector {
  const telemetry = dependencies.telemetry ?? null;
  const logger = dependencies.logger ?? null;
  const hintAttributes = dependencies.hintAttributes ?? DEFAULT_HINT_ATTRIBUTES;
  const getStyle = dependencies.getComputedStyle ?? defaultGetComputedStyle;
  const documentRef = dependencies.document ?? globalThis.document ?? null;

  const emit = (event: ScrollContainerTelemetryEvent): void => {
    try {
      telemetry?.emit(event);
    } catch {
      // ignore telemetry failures to avoid breaking detection flow
    }
  };

  const detector: ScrollContainerDetector = {
    detect(target, options) {
      const history: ScrollContainerStrategyStep[] = [];
      const hintsTried: string[] = [];

      const record = (step: ScrollContainerStrategyStep): void => {
        history.push(step);
        emit({
          kind: "candidate",
          strategy: step.kind,
          accepted: step.accepted,
          reason: step.reason,
          source: step.source
        });
      };

      const finish = (
        element: Element | null,
        strategy: ScrollContainerStrategyStep | null,
        fallbackApplied: boolean
      ): ScrollContainerResolution => {
        const summaries = history.map((entry) => summarizeStep(entry));

        emit({
          kind: fallbackApplied ? "fallback" : "resolved",
          strategy: strategy?.kind ?? "none",
          fallback: fallbackApplied,
          history
        });

        return {
          element,
          strategy,
          strategyHistory: [...history],
          hintsTried: [...hintsTried],
          fallbackApplied,
          summaries
        } satisfies ScrollContainerResolution;
      };

      const resolvedAncestor = resolveOverflowAncestor(
        target,
        options?.root ?? null,
        record,
        getStyle,
        logger
      );

      if (resolvedAncestor) {
        return finish(resolvedAncestor.element, resolvedAncestor.step, false);
      }

      const hintMatch = resolveHintContainer(
        target,
        {
          ...options?.hints,
          attributeNames: mergeHintAttributes(hintAttributes, options?.hints?.attributeNames)
        },
        options?.root ?? null,
        record,
        hintsTried,
        getStyle,
        logger
      );

      if (hintMatch) {
        return finish(hintMatch.element, hintMatch.step, false);
      }

      const contextMatch = resolveContextFallback(
        options?.context,
        record,
        getStyle,
        logger
      );

      if (contextMatch) {
        return finish(contextMatch.element, contextMatch.step, false);
      }

      const documentFallback = resolveDocumentFallback(documentRef, record, logger);
      return finish(documentFallback.element, documentFallback.step, documentFallback.fallbackApplied);
    }
  } satisfies ScrollContainerDetector;

  return detector;
}

interface AncestorResolution {
  element: Element | null;
  step: ScrollContainerStrategyStep;
}

function resolveOverflowAncestor(
  target: Element | null | undefined,
  root: Document | DocumentFragment | ShadowRoot | Element | null,
  record: (step: ScrollContainerStrategyStep) => void,
  getStyle: (element: Element) => CSSStyleDeclaration | null,
  logger: ScrollContainerDetectorDependencies["logger"]
): AncestorResolution | null {
  if (!isElement(target)) {
    return null;
  }

  const visited = new Set<Element>();

  for (const candidate of iterateAncestors(target, root, { includeSelf: true })) {
    if (visited.has(candidate)) {
      continue;
    }
    visited.add(candidate);

    const { accepted, reason } = evaluateScrollable(candidate, getStyle);

    const step: ScrollContainerStrategyStep = {
      kind: "ancestor-overflow",
      accepted,
      reason,
      element: candidate
    };

    record(step);

    if (accepted) {
      logger?.debug?.("scroll:container:ancestor", {
        accepted,
        reason
      });
      return { element: candidate, step } satisfies AncestorResolution;
    }
  }

  return null;
}

interface HintResolution {
  element: Element | null;
  step: ScrollContainerStrategyStep;
}

function resolveHintContainer(
  target: Element | null | undefined,
  hintOptions: ScrollContainerHintOptions | undefined,
  root: Document | DocumentFragment | ShadowRoot | Element | null,
  record: (step: ScrollContainerStrategyStep) => void,
  hintsTried: string[],
  getStyle: (element: Element) => CSSStyleDeclaration | null,
  logger: ScrollContainerDetectorDependencies["logger"]
): HintResolution | null {
  const attributeNames = hintOptions?.attributeNames ?? DEFAULT_HINT_ATTRIBUTES;

  const visitOrder = new Set<Element>();

  for (const origin of iterateAncestors(target, root, { includeSelf: true })) {
    if (visitOrder.has(origin)) {
      continue;
    }
    visitOrder.add(origin);

    for (const attribute of attributeNames) {
      const value = readAttribute(origin, attribute);
      if (value === null) {
        continue;
      }

      hintsTried.push(attribute);

      const resolved = resolveHintValue(value, origin, {
        root,
        resolve: hintOptions?.resolve
      });

      if (!isElement(resolved)) {
        const step: ScrollContainerStrategyStep = {
          kind: "hint-attribute",
          accepted: false,
          element: resolved ?? null,
          source: attribute,
          reason: `No container resolved for hint '${attribute}'`
        };

        record(step);
        continue;
      }

      const { accepted, reason } = evaluateScrollable(resolved, getStyle);

      const step: ScrollContainerStrategyStep = {
        kind: "hint-attribute",
        accepted,
        element: resolved,
        source: attribute,
        reason
      };

      record(step);

      if (accepted) {
        logger?.debug?.("scroll:container:hint", {
          attribute,
          reason
        });
        return { element: resolved, step } satisfies HintResolution;
      }
    }
  }

  return null;
}

interface ContextResolution {
  element: Element | null;
  step: ScrollContainerStrategyStep;
}

function resolveContextFallback(
  context: ScrollContainerContextOptions | undefined,
  record: (step: ScrollContainerStrategyStep) => void,
  getStyle: (element: Element) => CSSStyleDeclaration | null,
  logger: ScrollContainerDetectorDependencies["logger"]
): ContextResolution | null {
  if (!context) {
    return null;
  }

  if (Array.isArray(context.fallbackElements)) {
    for (const candidate of context.fallbackElements) {
      if (!isElement(candidate)) {
        continue;
      }

      const { accepted, reason } = evaluateScrollable(candidate, getStyle);
      const step: ScrollContainerStrategyStep = {
        kind: "context-element",
        accepted,
        element: candidate,
        reason
      };

      record(step);

      if (accepted) {
        logger?.debug?.("scroll:container:context-element", { reason });
        return { element: candidate, step } satisfies ContextResolution;
      }
    }
  }

  if (Array.isArray(context.fallbackKeys) && typeof context.resolveKey === "function") {
    for (const key of context.fallbackKeys) {
      if (!key) {
        continue;
      }

      const element = safeResolveKey(context.resolveKey, key);

      if (!isElement(element)) {
        const step: ScrollContainerStrategyStep = {
          kind: "context-key",
          accepted: false,
          element: element ?? null,
          source: key,
          reason: `No container resolved for context key '${key}'`
        };

        record(step);
        continue;
      }

      const { accepted, reason } = evaluateScrollable(element, getStyle);
      const step: ScrollContainerStrategyStep = {
        kind: "context-key",
        accepted,
        element,
        source: key,
        reason
      };

      record(step);

      if (accepted) {
        logger?.debug?.("scroll:container:context-key", {
          key,
          reason
        });
        return { element, step } satisfies ContextResolution;
      }
    }
  }

  return null;
}

interface DocumentResolution {
  element: Element | null;
  step: ScrollContainerStrategyStep | null;
  fallbackApplied: boolean;
}

function resolveDocumentFallback(
  documentRef: Document | null,
  record: (step: ScrollContainerStrategyStep) => void,
  logger: ScrollContainerDetectorDependencies["logger"]
): DocumentResolution {
  if (documentRef) {
    const scrollingElement = documentRef.scrollingElement;

    if (isElement(scrollingElement)) {
      const step: ScrollContainerStrategyStep = {
        kind: "document",
        accepted: true,
        element: scrollingElement,
        reason: "Fallback to document.scrollingElement"
      };

      record(step);
      logger?.warn?.("scroll:container:fallback:document", { reason: step.reason });

      return {
        element: scrollingElement,
        step,
        fallbackApplied: true
      } satisfies DocumentResolution;
    }

    const bodyCandidate = resolveDocumentBody(documentRef);

    if (isElement(bodyCandidate)) {
      const step: ScrollContainerStrategyStep = {
        kind: "document-body",
        accepted: true,
        element: bodyCandidate,
        reason: "Fallback to document.body"
      };

      record(step);
      logger?.warn?.("scroll:container:fallback:body", { reason: step.reason });

      return {
        element: bodyCandidate,
        step,
        fallbackApplied: true
      } satisfies DocumentResolution;
    }
  }

  const step: ScrollContainerStrategyStep = {
    kind: "none",
    accepted: false,
    element: null,
    reason: "No scroll container resolved"
  };

  record(step);

  logger?.warn?.("scroll:container:fallback:none", {
    reason: step.reason
  });

  return { element: null, step, fallbackApplied: true } satisfies DocumentResolution;
}

interface IterateOptions {
  includeSelf?: boolean;
}

function* iterateAncestors(
  element: Element | null | undefined,
  root: Document | DocumentFragment | ShadowRoot | Element | null,
  options: IterateOptions = {}
): Iterable<Element> {
  if (!isElement(element)) {
    return;
  }

  const includeSelf = options.includeSelf === true;

  let current: Element | null = includeSelf ? element : getParent(element);

  while (isElement(current) && current !== root) {
    yield current;
    current = getParent(current);
  }

  if (isElement(root)) {
    yield root;
  }
}

function getParent(element: Element): Element | null {
  if (typeof (element as { parentElement?: Element | null }).parentElement !== "undefined") {
    const parent = (element as { parentElement?: Element | null }).parentElement ?? null;
    if (isElement(parent)) {
      return parent;
    }
  }

  if (typeof (element as { assignedSlot?: Element | null }).assignedSlot !== "undefined") {
    const slot = (element as { assignedSlot?: Element | null }).assignedSlot ?? null;
    if (isElement(slot)) {
      return slot;
    }
  }

  const rootNode = typeof (element as { getRootNode?: () => Node }).getRootNode === "function"
    ? (element as { getRootNode?: () => Node }).getRootNode()
    : null;

  if (rootNode && isElement((rootNode as { host?: Element }).host)) {
    return (rootNode as { host?: Element }).host ?? null;
  }

  return null;
}

function evaluateScrollable(
  element: Element,
  getStyle: (element: Element) => CSSStyleDeclaration | null
): { accepted: boolean; reason?: string } {
  const style = getStyle(element);

  const overflowY = normalizeOverflow(style?.overflowY ?? style?.overflow);
  const overflowX = normalizeOverflow(style?.overflowX ?? style?.overflow);

  const metrics = getScrollMetrics(element);

  const verticalScrollable = overflowAllowsScroll(overflowY) && metrics.scrollHeight > metrics.clientHeight + 1;
  const horizontalScrollable = overflowAllowsScroll(overflowX) && metrics.scrollWidth > metrics.clientWidth + 1;

  if (verticalScrollable || horizontalScrollable) {
    return {
      accepted: true,
      reason: verticalScrollable ? "Vertical overflow" : "Horizontal overflow"
    };
  }

  if (overflowForcesScroll(overflowY) || overflowForcesScroll(overflowX)) {
    return {
      accepted: true,
      reason: "Overflow forces scroll"
    };
  }

  return {
    accepted: false,
    reason: "Overflow does not permit scrolling"
  };
}

function normalizeOverflow(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  return value.trim().toLowerCase();
}

function overflowAllowsScroll(value: string | undefined): boolean {
  return Boolean(value && SCROLLABLE_OVERFLOW_VALUES.has(value));
}

function overflowForcesScroll(value: string | undefined): boolean {
  return value === "scroll";
}

function getScrollMetrics(element: Element): {
  scrollHeight: number;
  clientHeight: number;
  scrollWidth: number;
  clientWidth: number;
} {
  const cast = element as Partial<HTMLElement>;

  const scrollHeight = resolveDimension(cast.scrollHeight);
  const clientHeight = resolveDimension(cast.clientHeight);
  const scrollWidth = resolveDimension(cast.scrollWidth);
  const clientWidth = resolveDimension(cast.clientWidth);

  return { scrollHeight, clientHeight, scrollWidth, clientWidth };
}

function resolveDimension(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  return 0;
}

function readAttribute(element: Element, attribute: string): string | null {
  if (typeof (element as { getAttribute?: (name: string) => string | null }).getAttribute === "function") {
    try {
      return (element as { getAttribute?: (name: string) => string | null }).getAttribute!(attribute);
    } catch {
      return null;
    }
  }

  if (typeof (element as { [key: string]: unknown })[attribute] === "string") {
    return String((element as { [key: string]: unknown })[attribute]);
  }

  return null;
}

interface HintResolveOptions {
  root: Document | DocumentFragment | ShadowRoot | Element | null;
  resolve?: (value: string, origin: Element) => Element | null | undefined;
}

function resolveHintValue(
  rawValue: string,
  origin: Element,
  options: HintResolveOptions
): Element | null {
  const value = rawValue.trim();

  if (value.length === 0 || value === "self" || value === "nearest" || value === "closest") {
    return origin;
  }

  const custom = options.resolve?.(value, origin);
  if (isElement(custom)) {
    return custom;
  }

  if (value.startsWith("#") || value.startsWith(".") || value.startsWith("[")) {
    const root = resolveRoot(options.root, origin);
    if (root && typeof (root as ParentNode).querySelector === "function") {
      try {
        const result = (root as ParentNode).querySelector(value);
        if (isElement(result)) {
          return result;
        }
      } catch {
        // ignore selector errors
      }
    }
  }

  if (/^[a-zA-Z0-9_-]+$/.test(value)) {
    const doc = resolveDocument(options.root, origin);
    if (doc && typeof doc.getElementById === "function") {
      const byId = doc.getElementById(value);
      if (isElement(byId)) {
        return byId;
      }
    }
  }

  return null;
}

function resolveRoot(
  root: Document | DocumentFragment | ShadowRoot | Element | null,
  origin: Element
): ParentNode | null {
  if (root && isParentNode(root)) {
    return root;
  }

  const owner = (origin as { ownerDocument?: Document | null }).ownerDocument ?? null;
  if (owner) {
    return owner;
  }

  if (isParentNode(origin)) {
    return origin;
  }

  return null;
}

function resolveDocument(
  root: Document | DocumentFragment | ShadowRoot | Element | null,
  origin: Element
): Document | null {
  if (typeof Document !== "undefined" && root instanceof Document) {
    return root;
  }

  const owner = (origin as { ownerDocument?: Document | null }).ownerDocument ?? null;
  if (owner) {
    return owner;
  }

  if (
    root &&
    typeof (root as { ownerDocument?: Document | null }).ownerDocument === "object"
  ) {
    const ownerDocument = (root as { ownerDocument?: Document | null }).ownerDocument ?? null;
    if (typeof Document !== "undefined" && ownerDocument instanceof Document) {
      return ownerDocument;
    }
  }

  return null;
}

function isParentNode(node: unknown): node is ParentNode {
  return Boolean(node && typeof (node as ParentNode).querySelector === "function");
}

function summarizeStep(step: ScrollContainerStrategyStep): string {
  const parts: string[] = [step.kind, step.accepted ? "accepted" : "rejected"];
  if (step.source) {
    parts.push(`source=${step.source}`);
  }
  if (step.reason) {
    parts.push(`reason=${step.reason}`);
  }
  return parts.join("|");
}

function mergeHintAttributes(
  defaults: string[],
  overrides: string[] | undefined
): string[] {
  if (!overrides || overrides.length === 0) {
    return defaults;
  }

  const seen = new Set<string>();
  const merged: string[] = [];

  for (const attribute of [...overrides, ...defaults]) {
    const normalized = attribute.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    merged.push(normalized);
  }

  return merged;
}

function isElement(value: unknown): value is Element {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (typeof Element !== "undefined") {
    return value instanceof Element;
  }

  return (value as { nodeType?: number }).nodeType === 1;
}

function resolveDocumentBody(doc: Document): Element | null {
  const body = (doc as { body?: Element | null }).body ?? null;
  if (isElement(body)) {
    return body;
  }

  const documentElement = (doc as { documentElement?: Element | null }).documentElement ?? null;
  if (isElement(documentElement)) {
    return documentElement;
  }

  return null;
}

function safeResolveKey(
  resolver: (key: string) => Element | null | undefined,
  key: string
): Element | null | undefined {
  try {
    return resolver(key);
  } catch {
    return undefined;
  }
}

function defaultGetComputedStyle(element: Element): CSSStyleDeclaration | null {
  if (typeof globalThis.getComputedStyle === "function") {
    try {
      return globalThis.getComputedStyle(element);
    } catch {
      return null;
    }
  }
  return null;
}
