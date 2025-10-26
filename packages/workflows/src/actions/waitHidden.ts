import {
  buildHandler,
  buildResult,
  type ActionExecutionArgs,
  type ActionRuntimeOptions
} from "./shared";
import type { StepResult, WaitHiddenStep, WorkflowStepHandler } from "../types";
import { buildWaitHintsFromStep, runWait, serializeWaitResult } from "./wait";

function buildVisibilityOptions(step: WaitHiddenStep) {
  return {
    target: "hidden" as const,
    requireDisplayed: step.requireDisplayed,
    requireInViewport: step.requireInViewport,
    minOpacity: step.minOpacity,
    minIntersectionRatio: step.minIntersectionRatio,
    minBoundingBoxArea: step.minBoundingBoxArea
  };
}

async function executeWaitHidden(
  args: ActionExecutionArgs<WaitHiddenStep>,
  runtime: ActionRuntimeOptions
): Promise<StepResult> {
  const { step } = args;
  const hints = buildWaitHintsFromStep(step);

  const execution = await runWait("waitHidden", args, runtime, {
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
    notes: step.name ?? "Hidden state confirmed",
    data: {
      wait: serializeWaitResult(execution.result, execution.options)
    }
  });
}

export function createWaitHiddenHandler(options: ActionRuntimeOptions = {}): WorkflowStepHandler {
  return buildHandler<WaitHiddenStep>((args, runtime) => executeWaitHidden(args, runtime), options);
}
