export type BackoffOptions = {
  initialDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  jitterRatio?: number;
  jitterMs?: number;
};

export type WaitOptions = {
  signal?: AbortSignal;
};

const DEFAULT_INITIAL_DELAY = 100;
const DEFAULT_MAX_DELAY = 1000;
const DEFAULT_FACTOR = 2;
const DEFAULT_JITTER_RATIO = 0.25;

export function computeBackoffDelay(attempt: number, options: BackoffOptions = {}): number {
  const base = Math.max(0, attempt - 1);
  const initial = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY;
  const max = Math.max(initial, options.maxDelayMs ?? DEFAULT_MAX_DELAY);
  const factor = options.factor ?? DEFAULT_FACTOR;
  const exponential = Math.min(max, initial * Math.pow(factor, base));

  const jitter = (() => {
    if (typeof options.jitterMs === "number") {
      return Math.max(0, options.jitterMs);
    }

    const jitterRatio = Math.max(0, Math.min(1, options.jitterRatio ?? DEFAULT_JITTER_RATIO));
    return exponential * jitterRatio;
  })();

  if (jitter === 0) {
    return exponential;
  }

  const min = Math.max(0, exponential - jitter);
  const maxWithJitter = exponential + jitter;

  if (min >= maxWithJitter) {
    return exponential;
  }

  return Math.random() * (maxWithJitter - min) + min;
}

export function wait(ms: number, options: WaitOptions = {}): Promise<void> {
  if (ms <= 0) {
    if (options.signal?.aborted) {
      return Promise.reject(buildAbortError(options.signal));
    }
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(buildAbortError(options.signal));
      return;
    }

    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const cleanup = () => {
      if (typeof timer !== "undefined") {
        clearTimeout(timer);
      }

      if (options.signal) {
        options.signal.removeEventListener("abort", onAbort);
      }
    };

    const onAbort = () => {
      cleanup();
      reject(buildAbortError(options.signal));
    };

    if (options.signal) {
      options.signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

function buildAbortError(signal?: AbortSignal): DOMException {
  return signal?.reason instanceof DOMException
    ? signal.reason
    : new DOMException("Operation aborted", "AbortError");
}
