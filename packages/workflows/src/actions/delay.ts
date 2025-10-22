import { wait } from "../../../core/utils/wait";
import { buildHandler, buildResult, type ActionExecutionArgs, type ActionRuntimeOptions } from "./shared";
import type { DelayStep, WorkflowStepHandler } from "../types";

async function executeDelay(args: ActionExecutionArgs<DelayStep>) {
  const { step, signal } = args;
  const duration = Math.max(0, step.ms);

  await wait(duration, { signal });

  return buildResult("success", {
    notes: step.name ?? `Delayed for ${duration}ms`
  });
}

export function createDelayHandler(options: ActionRuntimeOptions = {}): WorkflowStepHandler {
  return buildHandler(executeDelay, options);
}
