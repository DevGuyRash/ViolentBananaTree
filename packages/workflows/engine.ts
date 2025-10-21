import * as debug from "../core/debug";
import { resolveSelector, type ResolverOptions, type ResolveResult } from "../core/resolve";
import {
  createResolverTelemetry,
  type ResolverTelemetry
} from "../core/resolve-telemetry";
import {
  computeBackoffDelay,
  wait,
  type BackoffOptions
} from "../core/utils/wait";
import type { SelectorMap } from "../selectors/types";
import {
  InMemoryWorkflowContext,
  type WorkflowContext,
  type WorkflowDefinition,
  type WorkflowHandlers,
  type WorkflowRuntimeHooks,
  type WorkflowStep,
  type WorkflowStepExecutionArgs
} from "./types";

export type ResolveDelegate = (
  map: SelectorMap,
  key: string,
  options: ResolverOptions
) => Promise<ResolveResult> | ResolveResult;

export type WorkflowEngineOptions = {
  selectorMap: SelectorMap;
  handlers: WorkflowHandlers;
  context?: WorkflowContext;
  telemetry?: ResolverTelemetry;
  resolve?: ResolveDelegate;
  logger?: typeof debug;
  defaultTimeoutMs?: number;
  defaultRetries?: number;
  backoff?: BackoffOptions;
  hooks?: WorkflowRuntimeHooks;
};

export type WorkflowRunResult = {
  workflowId: string;
  completedSteps: number;
  context: Record<string, unknown>;
  status: "success" | "failed";
  error?: unknown;
};

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_RETRIES = 0;
const DEFAULT_BACKOFF: Required<Pick<BackoffOptions, "initialDelayMs" | "maxDelayMs" | "factor" | "jitterMs">> = {
  initialDelayMs: 100,
  maxDelayMs: 1000,
  factor: 2,
  jitterMs: 50
};

export class WorkflowStepTimeoutError extends Error {
  constructor(public readonly step: WorkflowStep, public readonly timeoutMs: number) {
    super(`Workflow step "${step.kind}" timed out after ${timeoutMs}ms`);
    this.name = "WorkflowStepTimeoutError";
  }
}

export class WorkflowStepExecutionError extends Error {
  constructor(public readonly step: WorkflowStep, public readonly cause: unknown) {
    super(`Workflow step "${step.kind}" failed`);
    this.name = "WorkflowStepExecutionError";
  }
}

export class WorkflowResolverMissError extends Error {
  constructor(public readonly step: WorkflowStep, public readonly result: ResolveResult) {
    super(`Resolver miss for key "${step.key ?? ""}" in step "${step.kind}"`);
    this.name = "WorkflowResolverMissError";
  }
}

type StepAttemptOutcome = {
  result: ResolveResult | null;
  attempt: number;
};

type RuntimeEnvironment = {
  options: Required<Pick<WorkflowEngineOptions, "selectorMap" | "handlers">> & {
    context: WorkflowContext;
    telemetry: ResolverTelemetry;
    resolve: ResolveDelegate;
    logger: typeof debug;
    timeoutMs: number;
    defaultRetries: number;
    backoff: Required<Pick<BackoffOptions, "initialDelayMs" | "maxDelayMs" | "factor" | "jitterMs">>;
    hooks?: WorkflowRuntimeHooks;
  };
};

export async function runWorkflow(
  definition: WorkflowDefinition,
  engineOptions: WorkflowEngineOptions
): Promise<WorkflowRunResult> {
  const runtime = createRuntimeEnvironment(engineOptions);
  const completedSteps: WorkflowStep[] = [];

  try {
    for (const step of definition.steps) {
      await executeStep(step, runtime);
      completedSteps.push(step);
    }

    return {
      workflowId: definition.id,
      completedSteps: completedSteps.length,
      context: runtime.options.context.snapshot(),
      status: "success"
    };
  } catch (error) {
    return {
      workflowId: definition.id,
      completedSteps: completedSteps.length,
      context: runtime.options.context.snapshot(),
      status: "failed",
      error
    };
  }
}

async function executeStep(step: WorkflowStep, runtime: RuntimeEnvironment): Promise<StepAttemptOutcome> {
  const handler = runtime.options.handlers[step.kind];

  if (!handler) {
    throw new WorkflowStepExecutionError(step, new Error(`No handler registered for "${step.kind}"`));
  }

  const maxAttempts = computeMaxAttempts(step, runtime.options.defaultRetries);

  let lastError: unknown = null;
  let lastResult: ResolveResult | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const retriesRemaining = maxAttempts - attempt;
    const resolveResult = step.key
      ? await resolveWithLogging(step, runtime, attempt)
      : null;

    lastResult = resolveResult;

    const executionArgs: WorkflowStepExecutionArgs = {
      step,
      attempt,
      retriesRemaining,
      context: runtime.options.context,
      resolveResult
    };

    if (step.key && resolveResult && !resolveResult.element) {
      lastError = new WorkflowResolverMissError(step, resolveResult);

      runtime.options.hooks?.onError?.(lastError, executionArgs);

      if (attempt >= maxAttempts) {
        throw new WorkflowStepExecutionError(step, lastError);
      }

      const missDelay = computeBackoffDelay(attempt + 1, buildBackoffOptions(step, runtime.options.backoff));
      await wait(missDelay);
      continue;
    }

    try {
      runtime.options.hooks?.beforeStep?.(executionArgs);

      await withTimeout(
        Promise.resolve(handler(executionArgs)),
        step.timeoutMs ?? runtime.options.timeoutMs,
        step
      );

      runtime.options.hooks?.afterStep?.(executionArgs);

      return {
        result: resolveResult,
        attempt
      };
    } catch (error) {
      lastError = error instanceof WorkflowStepExecutionError ? error.cause : error;

      runtime.options.logger.warn?.("Workflow step failed", {
        step: step.kind,
        id: step.id,
        attempt,
        error: serializeError(lastError)
      });

      runtime.options.hooks?.onError?.(error, executionArgs);

      if (attempt >= maxAttempts) {
        throw new WorkflowStepExecutionError(step, lastError);
      }

      const retryDelay = computeBackoffDelay(attempt + 1, buildBackoffOptions(step, runtime.options.backoff));
      await wait(retryDelay);
    }
  }

  throw new WorkflowStepExecutionError(step, lastError);
}

async function resolveWithLogging(
  step: WorkflowStep,
  runtime: RuntimeEnvironment,
  attempt: number
): Promise<ResolveResult> {
  const result = await Promise.resolve(
    runtime.options.resolve(runtime.options.selectorMap, step.key as string, {
      telemetry: runtime.options.telemetry,
      logger: runtime.options.logger
    })
  );

  if (!result.element) {
    runtime.options.logger.warn?.("Workflow resolver miss", {
      step: step.kind,
      id: step.id,
      key: step.key,
      attempt,
      attempts: result.attempts.length
    });
  } else {
    runtime.options.logger.info?.("Workflow resolver success", {
      step: step.kind,
      id: step.id,
      key: step.key,
      strategy: result.resolvedBy?.type
    });
  }

  return result;
}

function computeMaxAttempts(step: WorkflowStep, defaultRetries: number): number {
  const retries = typeof step.retries === "number" ? step.retries : defaultRetries;
  const bounded = Math.max(0, Math.floor(retries));
  return bounded + 1;
}

function buildBackoffOptions(
  step: WorkflowStep,
  defaults: Required<Pick<BackoffOptions, "initialDelayMs" | "maxDelayMs" | "factor" | "jitterMs">>
): BackoffOptions {
  return {
    initialDelayMs: step.backoffMs ?? defaults.initialDelayMs,
    maxDelayMs: defaults.maxDelayMs,
    factor: defaults.factor,
    jitterMs: step.jitterMs ?? defaults.jitterMs
  };
}

function createRuntimeEnvironment(options: WorkflowEngineOptions): RuntimeEnvironment {
  return {
    options: {
      selectorMap: options.selectorMap,
      handlers: options.handlers,
      context: options.context ?? new InMemoryWorkflowContext(),
      telemetry: options.telemetry ?? createResolverTelemetry({ source: "workflow-engine" }),
      resolve: options.resolve ?? ((map, key, resolveOptions) => resolveSelector(map, key, resolveOptions)),
      logger: options.logger ?? debug,
      timeoutMs: options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      defaultRetries: options.defaultRetries ?? DEFAULT_RETRIES,
      backoff: {
        initialDelayMs: options.backoff?.initialDelayMs ?? DEFAULT_BACKOFF.initialDelayMs,
        maxDelayMs: options.backoff?.maxDelayMs ?? DEFAULT_BACKOFF.maxDelayMs,
        factor: options.backoff?.factor ?? DEFAULT_BACKOFF.factor,
        jitterMs: options.backoff?.jitterMs ?? DEFAULT_BACKOFF.jitterMs
      },
      hooks: options.hooks
    }
  };
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message
    };
  }

  return {
    message: String(error)
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, step: WorkflowStep): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      reject(new WorkflowStepTimeoutError(step, timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (typeof timer !== "undefined") {
      clearTimeout(timer);
    }
  }
}
