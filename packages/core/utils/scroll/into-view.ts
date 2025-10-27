import type {
  ScrollContainerDetectionOptions,
  ScrollContainerDetector
} from "./container";

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_ALIGNMENT: IntoViewAlignment = {
  block: "nearest",
  inline: "nearest"
};
const DEFAULT_MARGIN: Required<IntoViewMargins> = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0
};
const ADJUSTMENT_TOLERANCE = 0.5;

export type IntoViewBlockAlignment = "start" | "center" | "end" | "nearest";
export type IntoViewInlineAlignment = "start" | "center" | "end" | "nearest";

export interface IntoViewAlignment {
  block?: IntoViewBlockAlignment;
  inline?: IntoViewInlineAlignment;
}

export interface IntoViewMargins {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

export interface IntoViewTelemetryAdjustmentEvent {
  attempt: number;
  container: Element;
  target: Element;
  deltaX: number;
  deltaY: number;
  nextScrollLeft: number;
  nextScrollTop: number;
  alignment: Required<IntoViewAlignment>;
  margin: Required<IntoViewMargins>;
}

export interface IntoViewTelemetrySettleEvent {
  success: boolean;
  attempts: number;
  container: Element | null;
  target: Element | null;
  reason?: string;
}

export interface IntoViewTelemetry {
  onAdjustment?(event: IntoViewTelemetryAdjustmentEvent): void;
  onSettle?(event: IntoViewTelemetrySettleEvent): void;
}

export interface IntoViewOptions {
  container?: Element | null;
  alignment?: IntoViewAlignment;
  margin?: number | IntoViewMargins;
  maxRetries?: number;
  telemetry?: IntoViewTelemetry | null;
  containerDetection?: ScrollContainerDetectionOptions;
}

export interface IntoViewResult {
  success: boolean;
  attempts: number;
  container: Element | null;
  target: Element | null;
  reason?: string;
}

export interface IntoViewDependencies {
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
  containerDetector?: ScrollContainerDetector | null;
}

export interface IntoViewScroller {
  scrollIntoView(target: Element | null | undefined, options?: IntoViewOptions): Promise<IntoViewResult>;
}

export function createIntoViewScroller(dependencies: IntoViewDependencies = {}): IntoViewScroller {
  const detector = dependencies.containerDetector ?? null;
  const requestFrame = resolveRequestFrame(dependencies.requestAnimationFrame);

  const scroller: IntoViewScroller = {
    scrollIntoView(target, options) {
      return new Promise<IntoViewResult>((resolve) => {
        if (!isElement(target)) {
          const result: IntoViewResult = {
            success: false,
            attempts: 0,
            container: null,
            target: null,
            reason: "invalid-target"
          };
          settle(options?.telemetry, result);
          resolve(result);
          return;
        }

        const alignment = normalizeAlignment(options?.alignment);
        const margin = normalizeMargin(options?.margin);
        const maxRetries = Math.max(0, options?.maxRetries ?? DEFAULT_MAX_RETRIES);

        const resolvedContainer = resolveContainer(target, options?.container, detector, options?.containerDetection);

        if (!isElement(resolvedContainer)) {
          const result: IntoViewResult = {
            success: false,
            attempts: 0,
            container: null,
            target,
            reason: "container-unavailable"
          };
          settle(options?.telemetry, result);
          resolve(result);
          return;
        }

        let attempts = 0;

        const performAttempt = (): void => {
          const measurement = measure(target, resolvedContainer);

          if (isFullyVisible(measurement, margin)) {
            const result: IntoViewResult = {
              success: true,
              attempts,
              container: resolvedContainer,
              target
            };
            settle(options?.telemetry, result);
            resolve(result);
            return;
          }

          if (attempts >= maxRetries) {
            const result: IntoViewResult = {
              success: false,
              attempts,
              container: resolvedContainer,
              target,
              reason: "max-retries"
            };
            settle(options?.telemetry, result);
            resolve(result);
            return;
          }

          const scrollMetrics = getScrollMetrics(resolvedContainer);

          const desiredTop = computeAlignedScroll(
            alignment.block,
            scrollMetrics.viewportHeight,
            measurement.targetRect.height,
            measurement.relativeTop + scrollMetrics.scrollTop,
            margin.top,
            margin.bottom,
            scrollMetrics.scrollTop
          );

          const desiredLeft = computeAlignedScroll(
            alignment.inline,
            scrollMetrics.viewportWidth,
            measurement.targetRect.width,
            measurement.relativeLeft + scrollMetrics.scrollLeft,
            margin.left,
            margin.right,
            scrollMetrics.scrollLeft
          );

          const clampedTop = clamp(desiredTop, 0, scrollMetrics.maxScrollTop);
          const clampedLeft = clamp(desiredLeft, 0, scrollMetrics.maxScrollLeft);

          const deltaY = clampedTop - scrollMetrics.scrollTop;
          const deltaX = clampedLeft - scrollMetrics.scrollLeft;

          if (Math.abs(deltaX) <= ADJUSTMENT_TOLERANCE && Math.abs(deltaY) <= ADJUSTMENT_TOLERANCE) {
            const result: IntoViewResult = {
              success: false,
              attempts,
              container: resolvedContainer,
              target,
              reason: "no-adjustment"
            };
            settle(options?.telemetry, result);
            resolve(result);
            return;
          }

          attempts += 1;

          setScrollPosition(resolvedContainer, clampedLeft, clampedTop);
          emitAdjustment(options?.telemetry, {
            attempt: attempts,
            container: resolvedContainer,
            target,
            deltaX,
            deltaY,
            nextScrollLeft: clampedLeft,
            nextScrollTop: clampedTop,
            alignment,
            margin
          });

          requestFrame(() => {
            performAttempt();
          });
        };

        requestFrame(() => {
          performAttempt();
        });
      });
    }
  } satisfies IntoViewScroller;

  return scroller;
}

function resolveRequestFrame(
  override?: (callback: FrameRequestCallback) => number
): (callback: FrameRequestCallback) => number {
  if (typeof override === "function") {
    return override;
  }

  if (typeof globalThis.requestAnimationFrame === "function") {
    return (cb) => globalThis.requestAnimationFrame(cb);
  }

  return (cb) => globalThis.setTimeout(() => cb(Date.now()), 16);
}

function resolveContainer(
  target: Element,
  explicit: Element | null | undefined,
  detector: ScrollContainerDetector | null,
  detectionOptions: ScrollContainerDetectionOptions | undefined
): Element | null {
  if (isElement(explicit)) {
    return explicit;
  }

  if (!detector) {
    return null;
  }

  try {
    const resolution = detector.detect(target, detectionOptions);
    if (isElement(resolution.element)) {
      return resolution.element;
    }
  } catch {
    return null;
  }

  return null;
}

function measure(target: Element, container: Element): Measurement {
  const containerRect = getRect(container);
  const targetRect = getRect(target);

  const relativeTop = targetRect.top - containerRect.top;
  const relativeLeft = targetRect.left - containerRect.left;

  return {
    containerRect,
    targetRect,
    relativeTop,
    relativeLeft
  } satisfies Measurement;
}

function isFullyVisible(measurement: Measurement, margin: Required<IntoViewMargins>): boolean {
  const { containerRect, targetRect } = measurement;

  const withinVertical =
    targetRect.top >= containerRect.top + margin.top - ADJUSTMENT_TOLERANCE &&
    targetRect.bottom <= containerRect.bottom - margin.bottom + ADJUSTMENT_TOLERANCE;

  const withinHorizontal =
    targetRect.left >= containerRect.left + margin.left - ADJUSTMENT_TOLERANCE &&
    targetRect.right <= containerRect.right - margin.right + ADJUSTMENT_TOLERANCE;

  return withinVertical && withinHorizontal;
}

function getRect(element: Element): DOMRect {
  if (typeof (element as { getBoundingClientRect?: () => DOMRect | DOMRectReadOnly }).getBoundingClientRect === "function") {
    const rect = (element as { getBoundingClientRect?: () => DOMRect | DOMRectReadOnly }).getBoundingClientRect!();
    return normalizeRect(rect);
  }

  return normalizeRect({
    top: 0,
    left: 0,
    bottom: 0,
    right: 0,
    height: 0,
    width: 0
  } as DOMRect);
}

function normalizeRect(rect: DOMRect | DOMRectReadOnly): DOMRect {
  if (typeof DOMRect !== "undefined" && rect instanceof DOMRect) {
    return rect;
  }

  const { top, left, bottom, right, width, height } = rect;
  const domRect = {
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

  return domRect;
}

function getScrollMetrics(container: Element): ScrollMetrics {
  const cast = container as unknown as Partial<HTMLElement>;

  const scrollTop = toNumber(cast.scrollTop);
  const scrollLeft = toNumber(cast.scrollLeft);
  const scrollHeight = Math.max(toNumber(cast.scrollHeight), 0);
  const scrollWidth = Math.max(toNumber(cast.scrollWidth), 0);
  const clientHeight = Math.max(toNumber(cast.clientHeight), 0) || inferClientSize(container, "height");
  const clientWidth = Math.max(toNumber(cast.clientWidth), 0) || inferClientSize(container, "width");

  const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
  const maxScrollLeft = Math.max(0, scrollWidth - clientWidth);

  return {
    scrollTop,
    scrollLeft,
    scrollHeight,
    scrollWidth,
    clientHeight,
    clientWidth,
    viewportHeight: clientHeight,
    viewportWidth: clientWidth,
    maxScrollTop,
    maxScrollLeft
  } satisfies ScrollMetrics;
}

function inferClientSize(element: Element, dimension: "height" | "width"): number {
  const rect = getRect(element);
  return dimension === "height" ? rect.height : rect.width;
}

function setScrollPosition(container: Element, left: number, top: number): void {
  const cast = container as unknown as Partial<HTMLElement> & { scroll?(x: number, y: number): void };

  if (typeof cast.scroll === "function") {
    try {
      cast.scroll(left, top);
      return;
    } catch {
      // fall through if scroll fails
    }
  }

  if (typeof cast.scrollTo === "function") {
    try {
      cast.scrollTo(left, top);
      return;
    } catch {
      // fall through if scrollTo fails
    }
  }

  if (typeof cast.scrollLeft === "number") {
    cast.scrollLeft = left;
  }

  if (typeof cast.scrollTop === "number") {
    cast.scrollTop = top;
  }
}

function computeAlignedScroll(
  alignment: IntoViewBlockAlignment | IntoViewInlineAlignment,
  viewport: number,
  subject: number,
  subjectOffset: number,
  marginStart: number,
  marginEnd: number,
  currentScroll: number
): number {
  const safeSpan = Math.max(0, viewport - marginStart - marginEnd);
  const targetStart = subjectOffset;
  const targetEnd = targetStart + subject;

  switch (alignment) {
    case "start":
      return targetStart - marginStart;
    case "end":
      return targetEnd - (viewport - marginEnd);
    case "center": {
      const safeCenter = marginStart + safeSpan / 2;
      const targetCenter = targetStart + subject / 2;
      return targetCenter - safeCenter;
    }
    case "nearest":
    default: {
      const startLimit = marginStart;
      const endLimit = viewport - marginEnd;

      if (targetStart >= startLimit && targetEnd <= endLimit) {
        return currentScroll;
      }

      if (targetStart < startLimit) {
        return targetStart - marginStart;
      }

      return targetEnd - (viewport - marginEnd);
    }
  }
}

function normalizeAlignment(alignment?: IntoViewAlignment): Required<IntoViewAlignment> {
  const block = alignment?.block ?? DEFAULT_ALIGNMENT.block;
  const inline = alignment?.inline ?? DEFAULT_ALIGNMENT.inline;
  return { block, inline } satisfies Required<IntoViewAlignment>;
}

function normalizeMargin(margin?: number | IntoViewMargins): Required<IntoViewMargins> {
  if (typeof margin === "number" && Number.isFinite(margin)) {
    return {
      top: Math.max(0, margin),
      right: Math.max(0, margin),
      bottom: Math.max(0, margin),
      left: Math.max(0, margin)
    } satisfies Required<IntoViewMargins>;
  }

  return {
    top: clampMargin(margin?.top),
    right: clampMargin(margin?.right),
    bottom: clampMargin(margin?.bottom),
    left: clampMargin(margin?.left)
  } satisfies Required<IntoViewMargins>;
}

function clampMargin(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_MARGIN.top;
  }
  return Math.max(0, value);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return 0;
}

function emitAdjustment(telemetry: IntoViewTelemetry | null | undefined, event: IntoViewTelemetryAdjustmentEvent): void {
  try {
    telemetry?.onAdjustment?.(event);
  } catch {
    // ignore telemetry failures to keep scrolling deterministic
  }
}

function settle(telemetry: IntoViewTelemetry | null | undefined, result: IntoViewResult): void {
  try {
    telemetry?.onSettle?.({
      success: result.success,
      attempts: result.attempts,
      container: result.container,
      target: result.target,
      reason: result.reason
    });
  } catch {
    // ignore telemetry failures
  }
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

interface Measurement {
  containerRect: DOMRect;
  targetRect: DOMRect;
  relativeTop: number;
  relativeLeft: number;
}

interface ScrollMetrics {
  scrollTop: number;
  scrollLeft: number;
  scrollHeight: number;
  scrollWidth: number;
  clientHeight: number;
  clientWidth: number;
  viewportHeight: number;
  viewportWidth: number;
  maxScrollTop: number;
  maxScrollLeft: number;
}
