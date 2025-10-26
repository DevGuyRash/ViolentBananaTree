import {
  buildHandler,
  buildResult,
  type ActionExecutionArgs,
  type ActionRuntimeOptions
} from "./shared";
import type { StepResult, WaitVisibleStep, WorkflowStepHandler } from "../types";
import { buildWaitHintsFromStep, runWait, serializeWaitResult } from "./wait";

function buildVisibilityOptions(step: WaitVisibleStep) {
  return {
    target: "visible" as const,
    requireDisplayed: step.requireDisplayed,
    requireInViewport: step.requireInViewport,
    minOpacity: step.minOpacity,
    minIntersectionRatio: step.minIntersectionRatio,
    minBoundingBoxArea: step.minBoundingBoxArea
  };
}

async function executeWaitVisible(
  args: ActionExecutionArgs<WaitVisibleStep>,
  runtime: ActionRuntimeOptions
): Promise<StepResult> {
  const { step } = args;
  const hints = buildWaitHintsFromStep(step);

  const execution = await runWait("waitVisible", args, runtime, {
    key: step.key,
    scopeKey: step.scopeKey,
    presenceThreshold: step.presenceThreshold ?? hints?.presenceThreshold,
    scrollerKey: step.scrollerKey ?? hints?.scrollerKey,
    maxResolverRetries: step.staleRetryCap,
    hints,
    visibility: buildVisibilityOptions(step),
    timeoutMs: step.timeoutMs,
    intervalMs: step.intervalMs,
    debug: step.debug
  });

  return buildResult("success", {
    notes: step.name ?? "Visibility condition satisfied",
    data: {
      wait: serializeWaitResult(execution.result, execution.options)
    }
  });
}

export function createWaitVisibleHandler(options: ActionRuntimeOptions = {}): WorkflowStepHandler {
  return buildHandler<WaitVisibleStep>((args, runtime) => executeWaitVisible(args, runtime), options);
}
