import {
  buildHandler,
  buildResult,
  type ActionExecutionArgs,
  type ActionRuntimeOptions
} from "./shared";
import type { StepResult, WaitForIdleStep, WorkflowStepHandler } from "../types";
import { buildWaitHintsFromStep, runWait, serializeWaitResult } from "./wait";

const DEFAULT_IDLE_MS = 500;

function buildIdleOptions(step: WaitForIdleStep) {
  const idleMs = typeof step.idleMs === "number" && Number.isFinite(step.idleMs) && step.idleMs > 0
    ? step.idleMs
    : DEFAULT_IDLE_MS;

  return {
    idleMs,
    maxWindowMs: step.maxWindowMs,
    heartbeatMs: step.heartbeatMs,
    captureStatistics: step.captureStatistics
  };
}

async function executeWaitForIdle(
  args: ActionExecutionArgs<WaitForIdleStep>,
  runtime: ActionRuntimeOptions
): Promise<StepResult> {
  const { step } = args;
  const hints = buildWaitHintsFromStep(step);

  const execution = await runWait("waitForIdle", args, runtime, {
    key: step.key,
    scopeKey: step.scopeKey,
    presenceThreshold: step.presenceThreshold ?? hints?.presenceThreshold,
    scrollerKey: step.scrollerKey ?? hints?.scrollerKey,
    maxResolverRetries: step.staleRetryCap,
    hints,
    idle: buildIdleOptions(step),
    timeoutMs: step.timeoutMs,
    intervalMs: step.intervalMs,
    debug: step.debug
  });

  return buildResult("success", {
    notes: step.name ?? "Idle window satisfied",
    data: {
      wait: serializeWaitResult(execution.result, execution.options)
    }
  });
}

export function createWaitForIdleHandler(options: ActionRuntimeOptions = {}): WorkflowStepHandler {
  return buildHandler<WaitForIdleStep>((args, runtime) => executeWaitForIdle(args, runtime), options);
}
