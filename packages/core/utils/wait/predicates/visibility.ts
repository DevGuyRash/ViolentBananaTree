import type { WaitPredicate, WaitPredicateResult } from "../scheduler";
import type { VisibilityOptions, WaitVisibilitySnapshot } from "../types";

export type VisibilityPredicateConfig = VisibilityOptions;

function parseOpacity(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function getComputedStyleSafe(element: Element): CSSStyleDeclaration | null {
  if (typeof globalThis.getComputedStyle !== "function") {
    return null;
  }

  try {
    return globalThis.getComputedStyle(element);
  } catch {
    return null;
  }
}

function getBoundingRect(element: Element): DOMRect | null {
  if (typeof element.getBoundingClientRect !== "function") {
    return null;
  }

  try {
    return element.getBoundingClientRect();
  } catch {
    return null;
  }
}

function toBoundingBox(rect: DOMRect | null): { width: number; height: number } | null {
  if (!rect) {
    return null;
  }

  return {
    width: rect.width,
    height: rect.height
  };
}

function computeIntersectionRatio(rect: DOMRect | null): number | null {
  if (!rect) {
    return null;
  }

  const docElement = globalThis.document?.documentElement ?? null;
  const viewportWidth = typeof globalThis.innerWidth === "number"
    ? globalThis.innerWidth
    : typeof docElement?.clientWidth === "number"
      ? docElement.clientWidth
      : null;
  const viewportHeight = typeof globalThis.innerHeight === "number"
    ? globalThis.innerHeight
    : typeof docElement?.clientHeight === "number"
      ? docElement.clientHeight
      : null;

  if (viewportWidth === null || viewportHeight === null || viewportWidth <= 0 || viewportHeight <= 0) {
    return null;
  }

  const elementArea = Math.max(0, rect.width) * Math.max(0, rect.height);
  if (elementArea <= 0) {
    return 0;
  }

  const viewportLeft = 0;
  const viewportTop = 0;
  const viewportRight = viewportWidth;
  const viewportBottom = viewportHeight;

  const intersectionWidth = Math.max(0, Math.min(rect.right, viewportRight) - Math.max(rect.left, viewportLeft));
  const intersectionHeight = Math.max(0, Math.min(rect.bottom, viewportBottom) - Math.max(rect.top, viewportTop));
  const intersectionArea = intersectionWidth * intersectionHeight;

  if (intersectionArea <= 0) {
    return 0;
  }

  return Math.min(1, intersectionArea / elementArea);
}

function isDisplayed(style: CSSStyleDeclaration | null, config: VisibilityPredicateConfig): boolean {
  if (!style) {
    return !config.requireDisplayed;
  }

  if (style.display === "none") {
    return false;
  }

  if (style.visibility === "hidden" || style.visibility === "collapse") {
    return false;
  }

  return true;
}

function meetsOpacity(style: CSSStyleDeclaration | null, config: VisibilityPredicateConfig): boolean {
  const resolvedOpacity = parseOpacity(style?.opacity ?? null);

  if (resolvedOpacity === null) {
    return true;
  }

  if (typeof config.minOpacity === "number") {
    return resolvedOpacity >= config.minOpacity;
  }

  return resolvedOpacity > 0;
}

function meetsBoundingBox(bounds: { width: number; height: number } | null, config: VisibilityPredicateConfig): boolean {
  if (!bounds) {
    return !config.minBoundingBoxArea;
  }

  const area = bounds.width * bounds.height;

  if (typeof config.minBoundingBoxArea === "number") {
    return area >= config.minBoundingBoxArea;
  }

  return area > 0;
}

function meetsIntersection(ratio: number | null, config: VisibilityPredicateConfig): boolean {
  if (ratio === null) {
    return !config.requireInViewport && typeof config.minIntersectionRatio !== "number";
  }

  if (config.requireInViewport && ratio <= 0) {
    return false;
  }

  if (typeof config.minIntersectionRatio === "number") {
    return ratio >= config.minIntersectionRatio;
  }

  return true;
}

function buildSnapshot(
  config: VisibilityPredicateConfig,
  style: CSSStyleDeclaration | null,
  bounds: { width: number; height: number } | null,
  ratio: number | null,
  computedState: "visible" | "hidden"
): WaitVisibilitySnapshot {
  return {
    computed: computedState,
    target: config.target,
    display: style?.display ?? null,
    visibility: style?.visibility ?? null,
    opacity: parseOpacity(style?.opacity ?? null),
    minOpacity: config.minOpacity,
    intersectionRatio: ratio,
    minIntersectionRatio: config.minIntersectionRatio,
    boundingBox: bounds
  } satisfies WaitVisibilitySnapshot;
}

export function evaluateVisibilityPredicate(
  element: Element,
  config: VisibilityPredicateConfig
): WaitPredicateResult {
  const target = config.target ?? "visible";
  const style = getComputedStyleSafe(element);
  const rect = getBoundingRect(element);
  const bounds = toBoundingBox(rect);
  const ratio = computeIntersectionRatio(rect);

  const displayed = isDisplayed(style, config);
  const opacityOk = meetsOpacity(style, config);
  const boundingOk = meetsBoundingBox(bounds, config);
  const intersectionOk = meetsIntersection(ratio, config);

  const visible = displayed && opacityOk && boundingOk && intersectionOk;
  const computedState: "visible" | "hidden" = visible ? "visible" : "hidden";
  const stale = !element.isConnected;

  const satisfied = target === "visible"
    ? visible && !stale
    : !visible && !stale;

  const snapshot = buildSnapshot({ ...config, target }, style, bounds, ratio, computedState);

  return {
    satisfied,
    stale,
    snapshot: {
      visibility: snapshot
    }
  } satisfies WaitPredicateResult;
}

export function createVisibilityPredicate(config: VisibilityPredicateConfig): WaitPredicate {
  const target = config.target ?? "visible";

  return ({ element }) => {
    if (!element) {
      return {
        satisfied: target === "hidden",
        stale: true,
        snapshot: {
          visibility: {
            computed: "hidden",
            target
          }
        }
      } satisfies WaitPredicateResult;
    }

    return evaluateVisibilityPredicate(element, { ...config, target });
  };
}
