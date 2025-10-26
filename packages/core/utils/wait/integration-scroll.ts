import {
  type WaitLogger,
  type WaitResolver,
  type WaitScheduleIntegration,
  type WaitScheduleIntegrationAfterResolveContext,
  type WaitScheduleIntegrationContext
} from "./scheduler";
import type { WaitOptions } from "./types";

const MIN_SCROLL_STEP_PX = 40;
const SCROLL_STEP_RATIO = 0.75;
const BASE_SCROLL_ATTEMPTS = 6;
const MAX_SCROLL_ATTEMPTS = 24;
const SCROLL_SETTLE_DELAY_MS = 50;

export interface WaitScrollIntegrationDependencies {
  resolver: WaitResolver;
  logger?: WaitLogger;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

interface WaitScrollIntegrationConfig {
  scrollerKey: string;
  presenceThreshold: number;
}

export function createWaitScrollIntegration(
  dependencies: WaitScrollIntegrationDependencies,
  options: WaitOptions
): WaitScheduleIntegration | null {
  const scrollerKey = options.scrollerKey ?? options.hints?.scrollerKey;

  if (!scrollerKey) {
    return null;
  }

  if (typeof Element === "undefined") {
    return null;
  }

  const presenceThreshold = resolvePresenceThreshold(options);

  return new WaitScrollIntegrationImpl(dependencies, {
    scrollerKey,
    presenceThreshold
  });
}

class WaitScrollIntegrationImpl implements WaitScheduleIntegration {
  private container: Element | null = null;
  private resolveLoggedMissing = false;
  private scrollAttempts = 0;
  private readonly maxScrollAttempts: number;
  private readonly scrollerKey: string;
  private readonly resolver: WaitResolver;
  private readonly logger?: WaitLogger;
  private readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;

  constructor(
    dependencies: WaitScrollIntegrationDependencies,
    config: WaitScrollIntegrationConfig
  ) {
    this.resolver = dependencies.resolver;
    this.logger = dependencies.logger;
    this.sleep = dependencies.sleep;
    this.scrollerKey = config.scrollerKey;

    const attemptBudget = Math.max(
      BASE_SCROLL_ATTEMPTS,
      Math.floor(config.presenceThreshold) * 3
    );

    this.maxScrollAttempts = Math.min(
      MAX_SCROLL_ATTEMPTS,
      Math.max(BASE_SCROLL_ATTEMPTS, attemptBudget)
    );
  }

  async beforeResolve(context: WaitScheduleIntegrationContext): Promise<void> {
    if (!this.container || !isElementConnected(this.container)) {
      await this.resolveContainer(context.signal);
    }
  }

  async afterResolve(
    context: WaitScheduleIntegrationAfterResolveContext
  ): Promise<"continue" | "retry"> {
    const target = context.resolution.resolveResult.element;

    if (target) {
      this.scrollAttempts = 0;
      return "continue";
    }

    const container = await this.resolveContainer(context.signal);
    if (!container) {
      return "continue";
    }

    if (this.scrollAttempts >= this.maxScrollAttempts) {
      return "continue";
    }

    if (!isScrollable(container)) {
      return "continue";
    }

    if (!scrollContainer(container)) {
      return "continue";
    }

    this.scrollAttempts += 1;

    this.logger?.debug?.("wait:scroll-integration", {
      scrollerKey: this.scrollerKey,
      pollCount: context.pollCount,
      attempts: this.scrollAttempts
    });

    await this.waitForSettle(context.signal);

    return "retry";
  }

  private async resolveContainer(signal?: AbortSignal): Promise<Element | null> {
    if (this.container && isElementConnected(this.container)) {
      return this.container;
    }

    try {
      const result = await Promise.resolve(this.resolver.resolve(this.scrollerKey, { signal }));

      if (result.element instanceof Element) {
        this.container = result.element;
        this.resolveLoggedMissing = false;
        return this.container;
      }

      if (!this.resolveLoggedMissing) {
        this.logger?.debug?.("wait:scroll-integration:missing-container", {
          scrollerKey: this.scrollerKey
        });
        this.resolveLoggedMissing = true;
      }

      this.container = null;
      return null;
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }

      if (!this.resolveLoggedMissing) {
        this.logger?.warn?.("wait:scroll-integration:resolve-error", {
          scrollerKey: this.scrollerKey,
          error: error instanceof Error ? error.message : String(error)
        });
        this.resolveLoggedMissing = true;
      }

      this.container = null;
      return null;
    }
  }

  private async waitForSettle(signal?: AbortSignal): Promise<void> {
    if (typeof this.sleep === "function") {
      await this.sleep(SCROLL_SETTLE_DELAY_MS, signal);
      return;
    }

    await waitWithTimeout(SCROLL_SETTLE_DELAY_MS, signal);
  }
}

function resolvePresenceThreshold(options: WaitOptions): number {
  const raw = (() => {
    if (typeof options.presenceThreshold === "number" && Number.isFinite(options.presenceThreshold)) {
      return options.presenceThreshold;
    }
    if (
      typeof options.hints?.presenceThreshold === "number" &&
      Number.isFinite(options.hints.presenceThreshold)
    ) {
      return options.hints.presenceThreshold;
    }
    return 1;
  })();

  const normalized = Math.max(1, Math.floor(raw));
  return Math.min(normalized, 50);
}

function isElementConnected(element: Element): boolean {
  if (typeof element.isConnected === "boolean") {
    return element.isConnected;
  }

  if (typeof document !== "undefined" && document) {
    return typeof document.contains === "function" ? document.contains(element) : true;
  }

  return true;
}

function isScrollable(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const scrollHeight = element.scrollHeight ?? 0;
  const clientHeight = element.clientHeight ?? 0;

  return scrollHeight > clientHeight + 1;
}

function scrollContainer(element: HTMLElement): boolean {
  const scrollHeight = element.scrollHeight ?? 0;
  const clientHeight = element.clientHeight ?? 0;
  const currentTop = element.scrollTop ?? 0;
  const maxTop = scrollHeight - clientHeight;

  if (maxTop <= 1) {
    return false;
  }

  if (currentTop >= maxTop - 1) {
    return false;
  }

  const step = Math.max(MIN_SCROLL_STEP_PX, Math.floor(clientHeight * SCROLL_STEP_RATIO));
  const nextTop = Math.min(maxTop, currentTop + step);

  if (Math.abs(nextTop - currentTop) < 1) {
    return false;
  }

  if (typeof element.scrollTo === "function") {
    element.scrollTo({ top: nextTop, behavior: "auto" });
  } else {
    element.scrollTop = nextTop;
  }

  const updatedTop = element.scrollTop ?? nextTop;
  return Math.abs(updatedTop - currentTop) >= 1;
}

function waitWithTimeout(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    if (signal?.aborted) {
      return Promise.reject(createAbortError(signal));
    }
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError(signal));
      return;
    }

    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const cleanup = () => {
      clearTimeout(timer);
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    };

    const onAbort = () => {
      cleanup();
      reject(createAbortError(signal));
    };

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

function createAbortError(signal?: AbortSignal): DOMException {
  if (signal?.reason instanceof DOMException) {
    return signal.reason;
  }

  return new DOMException("Operation aborted", "AbortError");
}
