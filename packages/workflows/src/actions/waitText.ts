import {
  buildHandler,
  buildResult,
  renderTemplate,
  withEnvironment,
  type ActionExecutionArgs,
  type ActionRuntimeOptions
} from "./shared";
import type { StepResult, WaitTextStep, WorkflowStepHandler } from "../types";
import { buildWaitHintsFromStep, runWait, serializeWaitResult } from "./wait";

async function executeWaitText(
  args: ActionExecutionArgs<WaitTextStep>,
  runtime: ActionRuntimeOptions
): Promise<StepResult> {
  const { step } = args;
  const templateOptions = withEnvironment(args, runtime.environment);
  const expected = renderTemplate(step.text, templateOptions).trim();

  const textPattern = buildCasePattern(expected, step.exact, step.caseSensitive);

  const hints = buildWaitHintsFromStep(step);

  const execution = await runWait("waitText", args, runtime, {
    text: expected.length > 0 ? expected : undefined,
    textPattern,
    textMode: step.exact ? "exact" : "contains",
    scopeKey: step.withinKey,
    presenceThreshold: step.presenceThreshold ?? hints?.presenceThreshold,
    scrollerKey: step.scrollerKey ?? hints?.scrollerKey,
    maxResolverRetries: step.staleRetryCap,
    hints,
    timeoutMs: step.timeoutMs,
    intervalMs: step.intervalMs,
    debug: step.debug
  });

  return buildResult("success", {
    notes: step.name ?? "Text condition satisfied",
    data: {
      wait: serializeWaitResult(execution.result, execution.options)
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
