import {
  WORKFLOW_DEFAULT_BACKOFF_MS,
  WORKFLOW_DEFAULT_INTERVAL_MS,
  WORKFLOW_DEFAULT_MAX_BACKOFF_MS,
  WORKFLOW_DEFAULT_TIMEOUT_MS,
  type WorkflowDefaults
} from "./types";

export interface RuntimeTimingOverrides {
  timeoutMs?: number;
  intervalMs?: number;
  retries?: number;
  backoffMs?: number;
  maxBackoffMs?: number;
  jitterMs?: number;
}

export interface RuntimeTimingConfig {
  timeoutMs: number;
  intervalMs: number;
  retries: number;
  backoffMs: number;
  maxBackoffMs: number;
  jitterMs: number;
}

export const DEFAULT_RUNTIME_TIMING: RuntimeTimingConfig = {
  timeoutMs: WORKFLOW_DEFAULT_TIMEOUT_MS,
  intervalMs: WORKFLOW_DEFAULT_INTERVAL_MS,
  retries: 0,
  backoffMs: WORKFLOW_DEFAULT_BACKOFF_MS,
  maxBackoffMs: WORKFLOW_DEFAULT_MAX_BACKOFF_MS,
  jitterMs: Math.round(WORKFLOW_DEFAULT_BACKOFF_MS * 0.25)
};

export function mergeRuntimeTiming(
  workflowDefaults?: WorkflowDefaults,
  overrides?: RuntimeTimingOverrides
): RuntimeTimingConfig {
  const workflow = workflowDefaults ?? {};
  const runtime = overrides ?? {};

  return {
    timeoutMs: coalesceNumber(runtime.timeoutMs, workflow.timeoutMs, DEFAULT_RUNTIME_TIMING.timeoutMs),
    intervalMs: coalesceNumber(runtime.intervalMs, workflow.intervalMs, DEFAULT_RUNTIME_TIMING.intervalMs),
    retries: coalesceNumber(runtime.retries, workflow.retries, DEFAULT_RUNTIME_TIMING.retries),
    backoffMs: coalesceNumber(runtime.backoffMs, workflow.backoffMs, DEFAULT_RUNTIME_TIMING.backoffMs),
    maxBackoffMs: coalesceNumber(runtime.maxBackoffMs, workflow.maxBackoffMs, DEFAULT_RUNTIME_TIMING.maxBackoffMs),
    jitterMs: coalesceNumber(runtime.jitterMs, workflow.jitterMs, DEFAULT_RUNTIME_TIMING.jitterMs)
  };
}

function coalesceNumber(...values: Array<number | undefined>): number {
  if (values.length === 0) {
    return 0;
  }

  const fallback = values.pop();

  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  if (typeof fallback === "number" && Number.isFinite(fallback)) {
    return fallback;
  }

  return 0;
}
