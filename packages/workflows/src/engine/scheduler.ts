import { computeBackoffDelay, wait } from "../../../core/utils/wait";
import type { ResolveResult } from "../../../core/resolve";
import {
  type Condition,
  type ForeachStep,
  type IfStep,
  type RetryPolicy,
  type RetryStep,
  type StepContextUpdate,
  type StepLogEntry,
  type StepResult,
  type StepResultStatus,
  type StepTelemetryEvent,
  type WorkflowDefinition,
  type WorkflowHandlers,
  type WorkflowRuntimeLogger,
  type WorkflowStep,
  type WorkflowStepExecutionArgs
} from "../types";
import {
  StepError,
  buildCancellationError,
  buildFailureError,
  buildResolverMissError,
  buildTimeoutError
} from "./errors";
import { createContextManager, type WorkflowContextManager } from "./context";
import type {
  WorkflowResolverRequest,
  WorkflowScheduler,
  WorkflowSchedulerEnvironment,
  WorkflowSchedulerResult
} from "./runtime";

type StepExecutionConfig = {
  timeoutMs: number;
  retries: number;
  backoffMs: number;
  maxBackoffMs: number;
  jitterMs: number;
};

interface SchedulerState {
  completedSteps: number;
  cancelled: boolean;
  contextManager: WorkflowContextManager;
}

interface StepExecutionContext {
  env: WorkflowSchedulerEnvironment;
  state: SchedulerState;
  stepIndex: number;
  parentBranch?: string;
}

const CONTROL_FLOW_STEPS: Array<WorkflowStep["kind"]> = ["if", "foreach", "retry"];

export class DefaultWorkflowScheduler implements WorkflowScheduler {
  async run(env: WorkflowSchedulerEnvironment): Promise<WorkflowSchedulerResult> {
    const contextManager = createContextManager(env.context);
    env.context = contextManager.context;

    const state: SchedulerState = {
      completedSteps: 0,
      cancelled: false,
      contextManager
    };

    try {
      await executeBranch(env.definition, env, state);
      return {
        status: state.cancelled ? "cancelled" : "success",
        completedSteps: state.completedSteps
      } satisfies WorkflowSchedulerResult;
    } catch (error) {
      const stepError = normalizeStepError(error);
      const status: WorkflowSchedulerResult["status"] = stepError.reason === "cancelled" ? "cancelled" : "failed";

      return {
        status,
        completedSteps: state.completedSteps,
        error: stepError
      } satisfies WorkflowSchedulerResult;
    }
  }
}

export function createDefaultScheduler(): WorkflowScheduler {
  return new DefaultWorkflowScheduler();
}

async function executeBranch(
  definition: WorkflowDefinition | WorkflowStep[],
  env: WorkflowSchedulerEnvironment,
  state: SchedulerState,
  parentBranch?: string
): Promise<void> {
  const steps: WorkflowStep[] = Array.isArray(definition) ? definition : definition.steps;

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];

    const context: StepExecutionContext = {
      env,
      state,
      stepIndex: index,
      parentBranch
    };

    await executeStep(step, context);
  }
}

async function executeStep(step: WorkflowStep, context: StepExecutionContext): Promise<void> {
  const { env, state } = context;

  state.contextManager.pruneExpired();

  try {
    ensureNotCancelled(step, env);
  } catch (error) {
    const cancelledError = normalizeStepError(error, step, 0, undefined, extractLogicalKey(step));
    if (cancelledError.reason === "cancelled") {
      state.cancelled = true;
    }

    emitTelemetryEvent(env, step, context, {
      status: "skipped",
      attempt: 0,
      error: cancelledError.toPayload()
    });

    throw cancelledError;
  }

  emitTelemetryEvent(env, step, context, {
    status: "pending",
    attempt: 0
  });

  if (isControlFlowStep(step)) {
    await executeControlFlowStep(step, context);
    state.completedSteps += 1;
    env.metadata.completedSteps = state.completedSteps;
    emitTelemetryEvent(env, step, context, {
      status: "success",
      attempt: 1
    });
    return;
  }

  await executeAtomicStep(step, context);
}

async function executeAtomicStep(step: WorkflowStep, context: StepExecutionContext): Promise<void> {
  const { env, state } = context;
  const handler = resolveHandler(step, env.handlers);
  const config = resolveStepConfig(step, env);
  const maxAttempts = Math.max(1, config.retries + 1);
  let lastError: StepError | undefined;
  let attempt = 0;
  let resolved: ResolveResult | null = null;
  const logicalKey = extractLogicalKey(step);

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      ensureNotCancelled(step, env);
    } catch (error) {
      const cancelledError = normalizeStepError(error, step, attempt, undefined, logicalKey);
      if (cancelledError.reason === "cancelled") {
        state.cancelled = true;
      }
      emitTelemetryEvent(env, step, context, {
        status: "skipped",
        attempt,
        logicalKey,
        error: cancelledError.toPayload()
      });
      throw cancelledError;
    }

    const attemptStartedAt = Date.now();
    emitTelemetryEvent(env, step, context, {
      status: "attempt",
      attempt,
      logicalKey
    });

    try {
      resolved = await resolveLogicalKeyIfNeeded(step, env, attempt);

      if (logicalKey && !resolved?.element) {
        throw buildResolverMissError(step, logicalKey, attempt, {
          strategies: resolved?.attempts?.map((item) => item.strategy) ?? []
        });
      }

      const handlerResult = await executeHandlerWithTimeout(
        step,
        handler,
        resolved,
        attempt,
        maxAttempts - attempt,
        config.timeoutMs,
        env
      );

      const duration = Date.now() - attemptStartedAt;
      const applied = applyStepResult(handlerResult, env, state);
      state.completedSteps += 1;
      env.metadata.completedSteps = state.completedSteps;
      emitTelemetryEvent(env, step, context, {
        status: applied.status === "skipped" ? "skipped" : "success",
        attempt,
        durationMs: duration,
        logicalKey,
        notes: applied.notes,
        data: applied.data
      });
      return;
    } catch (error) {
      const duration = Date.now() - attemptStartedAt;
      lastError = normalizeStepError(error, step, attempt, duration, logicalKey);

      emitTelemetryEvent(env, step, context, {
        status: "failure",
        attempt,
        durationMs: duration,
        logicalKey,
        error: lastError.toPayload()
      });

      if (lastError.reason === "cancelled") {
        state.cancelled = true;
        throw lastError;
      }

      if (attempt >= maxAttempts) {
        throw lastError;
      }

      const backoffDelay = computeBackoffDelay(attempt + 1, {
        initialDelayMs: config.backoffMs,
        maxDelayMs: config.maxBackoffMs,
        jitterMs: config.jitterMs
      });

      await wait(backoffDelay, { signal: env.signal });
    }
  }

  if (lastError) {
    throw lastError;
  }
}

async function executeControlFlowStep(step: WorkflowStep, context: StepExecutionContext): Promise<void> {
  switch (step.kind) {
    case "if":
      await executeIfStep(step, context);
      return;
    case "foreach":
      await executeForeachStep(step, context);
      return;
    case "retry":
      await executeRetryStep(step, context);
      return;
    default:
      throw new StepError({
        reason: "unknown",
        message: `Unsupported control flow step '${step.kind}'`,
        stepKind: step.kind
      });
  }
}

async function executeIfStep(step: IfStep, context: StepExecutionContext): Promise<void> {
  const result = await evaluateCondition(step.when, context);
  const branch = result ? step.then : step.else;

  if (!branch || branch.length === 0) {
    return;
  }

  await context.state.contextManager.withScope(async () => {
    await executeBranch(branch, context.env, context.state, buildBranchName(context, step.kind));
  }, step.kind);
}

async function executeForeachStep(step: ForeachStep, context: StepExecutionContext): Promise<void> {
  const { env, state } = context;
  const manager = state.contextManager;
  const collected = manager.get<unknown>(step.list);
  const list = Array.isArray(collected) ? collected : [];

  if (list.length === 0) {
    return;
  }

  for (let index = 0; index < list.length; index += 1) {
    ensureNotCancelled(step, env);

    await manager.withScope(async (scope) => {
      scope.set(step.as, list[index]);

      if (typeof step.indexVar === "string" && step.indexVar.length > 0) {
        scope.set(step.indexVar, index);
      }

      await executeBranch(step.steps, env, context.state, buildBranchName(context, `${step.kind}[${index}]`));

      scope.delete(step.as);

      if (typeof step.indexVar === "string" && step.indexVar.length > 0) {
        scope.delete(step.indexVar);
      }
    }, `${step.kind}[${index}]`);
  }
}

async function executeRetryStep(step: RetryStep, context: StepExecutionContext): Promise<void> {
  const { env } = context;
  const policy = mergeRetryPolicy(step.policy, env);
  const maxAttempts = Math.max(1, policy.retries + 1);
  let attempt = 0;
  let lastError: StepError | undefined;

  while (attempt < maxAttempts) {
    attempt += 1;

    try {
      await context.state.contextManager.withScope(async () => {
        await executeBranch(step.steps, env, context.state, buildBranchName(context, `${step.kind}#${attempt}`));
      }, `${step.kind}#${attempt}`);
      return;
    } catch (error) {
      lastError = normalizeStepError(error);

      if (lastError.reason === "cancelled") {
        context.state.cancelled = true;
        throw lastError;
      }

      if (attempt >= maxAttempts) {
        throw lastError;
      }

      const delay = computeBackoffDelay(attempt + 1, {
        initialDelayMs: policy.backoffMs,
        maxDelayMs: policy.maxBackoffMs,
        jitterMs: policy.jitterMs
      });

      await wait(delay, { signal: env.signal });
    }
  }

  if (lastError) {
    throw lastError;
  }
}

async function executeHandlerWithTimeout(
  step: WorkflowStep,
  handler: WorkflowHandlers[keyof WorkflowHandlers],
  resolveResult: ResolveResult | null,
  attempt: number,
  retriesRemaining: number,
  timeoutMs: number,
  env: WorkflowSchedulerEnvironment
): Promise<StepResult | void> {
  const args: WorkflowStepExecutionArgs = {
    step,
    attempt,
    retriesRemaining,
    context: env.context,
    resolveResult,
    runId: env.runId,
    workflowId: env.definition.id,
    logger: env.logger,
    signal: env.signal,
    resolveLogicalKey: (key: string) =>
      env.resolver.resolve(createResolverRequest(key, step, env, attempt))
  };

  const execution = Promise.resolve().then(() => handler(args));

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return execution;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(buildTimeoutError(step, timeoutMs, attempt));
    }, timeoutMs);
  });

  try {
    return await Promise.race([execution, timeout]);
  } finally {
    if (typeof timer !== "undefined") {
      clearTimeout(timer);
    }
  }
}

function applyStepResult(
  result: StepResult | void,
  env: WorkflowSchedulerEnvironment,
  state: SchedulerState
): { status: StepResultStatus; notes?: string; data?: Record<string, unknown> } {
  if (!result) {
    return { status: "success" } satisfies { status: StepResultStatus; notes?: string; data?: Record<string, unknown> };
  }

  const status: StepResultStatus = result.status ?? "success";

  if (Array.isArray(result.contextUpdates) && result.contextUpdates.length > 0) {
    applyContextUpdates(state, result.contextUpdates);
  }

  if (Array.isArray(result.logs) && result.logs.length > 0) {
    emitResultLogs(env.logger, result.logs);
  }

  return {
    status,
    notes: result.notes,
    data: result.data
  } satisfies { status: StepResultStatus; notes?: string; data?: Record<string, unknown> };
}

function applyContextUpdates(state: SchedulerState, updates: StepContextUpdate[]): void {
  updates.forEach((update) => {
    if (typeof update?.path !== "string" || update.path.length === 0) {
      return;
    }

    state.contextManager.set(update.path, update.value, typeof update.ttlMs === "number" ? { ttlMs: update.ttlMs } : undefined);
  });
}

function emitResultLogs(logger: WorkflowRuntimeLogger | undefined, logs: StepLogEntry[]): void {
  if (!logger) {
    return;
  }

  logs.forEach((entry) => {
    const method = logger[entry.level];

    if (typeof method === "function") {
      method(entry.message, entry.data);
    }
  });
}

function createResolverRequest(
  key: string,
  step: WorkflowStep,
  env: WorkflowSchedulerEnvironment,
  attempt: number
): WorkflowResolverRequest {
  const resolverStep = { ...step, key } as WorkflowStep & { key: string };

  return {
    runId: env.runId,
    workflowId: env.definition.id,
    step: resolverStep,
    attempt,
    signal: env.signal,
    context: env.context,
    logger: env.logger
  } satisfies WorkflowResolverRequest;
}

async function resolveLogicalKeyIfNeeded(
  step: WorkflowStep,
  env: WorkflowSchedulerEnvironment,
  attempt: number
): Promise<ResolveResult | null> {
  const logicalKey = extractLogicalKey(step);

  if (!logicalKey) {
    return null;
  }

  const stepWithKey = { ...step, key: logicalKey } as WorkflowStep & { key: string };

  return env.resolver.resolve({
    runId: env.runId,
    workflowId: env.definition.id,
    step: stepWithKey,
    attempt,
    signal: env.signal,
    context: env.context,
    logger: env.logger
  });
}

async function evaluateCondition(condition: Condition, context: StepExecutionContext): Promise<boolean> {
  const { env } = context;

  switch (condition.kind) {
    case "ctxEquals":
      return env.context.get(condition.path) === condition.value;
    case "ctxNotEquals":
      return env.context.get(condition.path) !== condition.value;
    case "ctxDefined":
      return env.context.get(condition.path) !== undefined;
    case "ctxMissing":
      return env.context.get(condition.path) === undefined;
    case "exists":
      return await resolveExists(condition.key, env, condition);
    case "notExists":
      return !(await resolveExists(condition.key, env, condition));
    case "textContains":
      return await resolveTextContains(condition.key, condition.text, condition, env);
    case "urlIncludes":
      return typeof env.context.get("_currentUrl") === "string"
        ? String(env.context.get("_currentUrl")).includes(condition.value)
        : false;
    case "matches":
      env.logger.warn?.("Workflow condition 'matches' not supported", {
        expression: condition.expression
      });
      return false;
    case "allOf":
      return Array.isArray(condition.conditions)
        ? everyAsync(condition.conditions, (child) => evaluateCondition(child, context))
        : false;
    case "anyOf":
      return Array.isArray(condition.conditions)
        ? someAsync(condition.conditions, (child) => evaluateCondition(child, context))
        : false;
    case "not":
      return !(condition.condition && (await evaluateCondition(condition.condition, context)));
    default:
      return false;
  }
}

async function resolveExists(
  key: string,
  env: WorkflowSchedulerEnvironment,
  step: { kind: string }
): Promise<boolean> {
  try {
    const probeStep = {
      kind: "waitFor",
      id: `${step.kind}:${key}`,
      key
    } as WorkflowStep & { key: string };

    const result = await env.resolver.resolve({
      runId: env.runId,
      workflowId: env.definition.id,
      step: probeStep,
      attempt: 1,
      signal: env.signal,
      context: env.context,
      logger: env.logger
    });

    return Boolean(result?.element);
  } catch {
    return false;
  }
}

async function resolveTextContains(
  key: string,
  expected: string,
  condition: { kind: string; exact?: boolean },
  env: WorkflowSchedulerEnvironment
): Promise<boolean> {
  try {
    const probeStep = {
      kind: "waitText",
      id: `${condition.kind}:${key}`,
      key
    } as WorkflowStep & { key: string };

    const result = await env.resolver.resolve({
      runId: env.runId,
      workflowId: env.definition.id,
      step: probeStep,
      attempt: 1,
      signal: env.signal,
      context: env.context,
      logger: env.logger
    });

    const text = result?.element?.textContent ?? "";
    return condition.exact ? text === expected : text.includes(expected);
  } catch {
    return false;
  }
}

function resolveHandler(step: WorkflowStep, handlers: WorkflowHandlers) {
  const handler = handlers[step.kind];

  if (!handler) {
    throw buildFailureError(step, new Error(`Missing handler for step '${step.kind}'`), 1);
  }

  return handler;
}

function resolveStepConfig(step: WorkflowStep, env: WorkflowSchedulerEnvironment): StepExecutionConfig {
  const { timing } = env;

  return {
    timeoutMs: resolveNumber(step.timeoutMs, timing.timeoutMs),
    retries: resolveNumber(step.retries, timing.retries),
    backoffMs: resolveNumber(step.backoffMs, timing.backoffMs),
    maxBackoffMs: resolveNumber(step.maxBackoffMs, timing.maxBackoffMs),
    jitterMs: resolveNumber(step.jitterMs, timing.jitterMs)
  } satisfies StepExecutionConfig;
}

function mergeRetryPolicy(policy: RetryPolicy | undefined, env: WorkflowSchedulerEnvironment): Required<RetryPolicy> {
  return {
    retries: Math.max(0, resolveNumber(policy?.retries, env.timing.retries)),
    backoffMs: resolveNumber(policy?.backoffMs, env.timing.backoffMs),
    maxBackoffMs: resolveNumber(policy?.maxBackoffMs, env.timing.maxBackoffMs),
    jitterMs: resolveNumber(policy?.jitterMs, env.timing.jitterMs),
    resetOnSuccess: Boolean(policy?.resetOnSuccess)
  };
}

function resolveNumber(preferred: number | undefined, fallback: number): number {
  if (typeof preferred === "number" && Number.isFinite(preferred)) {
    return preferred;
  }
  return fallback;
}

function extractLogicalKey(step: WorkflowStep): string | undefined {
  if (typeof (step as { key?: unknown }).key === "string" && (step as { key: string }).key.length > 0) {
    return (step as { key: string }).key;
  }
  return undefined;
}

function emitTelemetryEvent(
  env: WorkflowSchedulerEnvironment,
  step: WorkflowStep,
  context: StepExecutionContext,
  event: Partial<StepTelemetryEvent>
): void {
  const payload: StepTelemetryEvent = {
    runId: env.runId,
    workflowId: env.definition.id,
    stepIndex: context.stepIndex,
    stepId: step.id,
    stepKind: step.kind,
    logicalKey: event.logicalKey ?? extractLogicalKey(step),
    status: event.status ?? "pending",
    attempt: event.attempt ?? 0,
    timestamp: Date.now(),
    durationMs: event.durationMs,
    data: event.data,
    error: event.error,
    notes: event.notes
  };

  env.telemetry.stepEvent?.(payload);
}

function ensureNotCancelled(step: WorkflowStep, env: WorkflowSchedulerEnvironment): void {
  if (!env.signal.aborted) {
    return;
  }

  throw buildCancellationError(step, 0);
}

function normalizeStepError(
  error: unknown,
  step?: WorkflowStep,
  attempts?: number,
  durationMs?: number,
  logicalKey?: string
): StepError {
  if (error instanceof StepError) {
    return error;
  }

  if (!step) {
    return new StepError({
      reason: "unknown",
      message: error instanceof Error ? error.message : String(error),
      stepKind: "log",
      attempts,
      logicalKey,
      elapsedMs: durationMs
    });
  }

  if (error instanceof Error && error.name === "AbortError") {
    return buildCancellationError(step, attempts ?? 0);
  }

  if (error instanceof DOMException && error.name === "AbortError") {
    return buildCancellationError(step, attempts ?? 0);
  }

  if (error instanceof Error && /timed out/i.test(error.message)) {
    return buildTimeoutError(step, step.timeoutMs ?? 0, attempts ?? 0);
  }

  return buildFailureError(step, error, attempts ?? 0);
}

function isControlFlowStep(step: WorkflowStep): step is IfStep | ForeachStep | RetryStep {
  return CONTROL_FLOW_STEPS.includes(step.kind);
}

async function everyAsync<T>(items: T[], predicate: (item: T) => Promise<boolean> | boolean): Promise<boolean> {
  for (const item of items) {
    if (!(await predicate(item))) {
      return false;
    }
  }
  return true;
}

async function someAsync<T>(items: T[], predicate: (item: T) => Promise<boolean> | boolean): Promise<boolean> {
  for (const item of items) {
    if (await predicate(item)) {
      return true;
    }
  }
  return false;
}

function buildBranchName(context: StepExecutionContext, name: string): string {
  return context.parentBranch ? `${context.parentBranch}.${name}` : name;
}
