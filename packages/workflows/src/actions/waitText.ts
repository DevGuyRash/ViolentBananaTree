import {
  buildHandler,
  buildResult,
  renderTemplate,
  withEnvironment,
  type ActionExecutionArgs,
  type ActionRuntimeOptions
} from "./shared";
import type { StepResult, WaitTextStep, WorkflowStepHandler } from "../types";
import { runWait, serializeWaitResult } from "./wait";

async function executeWaitText(
  args: ActionExecutionArgs<WaitTextStep>,
  runtime: ActionRuntimeOptions
): Promise<StepResult> {
  const { step } = args;
  const templateOptions = withEnvironment(args, runtime.environment);
  const expected = renderTemplate(step.text, templateOptions).trim();

  const textPattern = buildCasePattern(expected, step.exact, step.caseSensitive);

  const result = await runWait("waitText", args, runtime, {
    text: expected.length > 0 ? expected : undefined,
    textPattern,
    textMode: step.exact ? "exact" : "contains",
    scopeKey: step.withinKey,
    timeoutMs: step.timeoutMs,
    intervalMs: step.intervalMs,
    debug: step.debug
  });

  return buildResult("success", {
    notes: step.name ?? "Text condition satisfied",
    data: {
      wait: serializeWaitResult(result)
    }
  });
}

function buildCasePattern(value: string, exact?: boolean, caseSensitive?: boolean): RegExp | undefined {
  if (!value) {
    return undefined;
  }

  if (caseSensitive) {
    return undefined;
  }

  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = exact ? `^${escaped}$` : escaped;
  return new RegExp(pattern, "i");
}

export function createWaitTextHandler(options: ActionRuntimeOptions = {}): WorkflowStepHandler {
  return buildHandler<WaitTextStep>((args, runtime) => executeWaitText(args, runtime), options);
}
