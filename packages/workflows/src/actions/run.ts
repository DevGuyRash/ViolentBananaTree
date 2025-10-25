import { StepError } from "../engine/errors";
import { buildHandler, buildResult, type ActionExecutionArgs, type ActionRuntimeOptions } from "./shared";
import type { RunStep, WorkflowStepHandler } from "../types";

async function executeRun(
  args: ActionExecutionArgs<RunStep>,
  _runtime: ActionRuntimeOptions
): Promise<never> {
  throw new StepError({
    reason: "unknown",
    message: `Nested workflow execution not yet implemented for '${args.step.workflowId}'`,
    stepKind: args.step.kind,
    stepId: args.step.id
  });
}

export function createRunHandler(options: ActionRuntimeOptions = {}): WorkflowStepHandler {
  return buildHandler<RunStep>(executeRun, options);
}
