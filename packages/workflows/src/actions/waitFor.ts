import {
  buildHandler,
  buildResult,
  renderTemplate,
  withEnvironment,
  type ActionExecutionArgs,
  type ActionRuntimeOptions
} from "./shared";
import type { StepResult, WaitForStep, WorkflowStepHandler } from "../types";
import { buildWaitHintsFromStep, runWait, serializeWaitResult } from "./wait";

async function executeWaitFor(
  args: ActionExecutionArgs<WaitForStep>,
  runtime: ActionRuntimeOptions
): Promise<StepResult> {
  const { step } = args;
  const templateOptions = withEnvironment(args, runtime.environment);
  const renderedText = renderTemplate(step.text, templateOptions).trim();

  const hints = buildWaitHintsFromStep(step);

  const execution = await runWait("waitFor", args, runtime, {
    key: step.key,
    css: step.css,
    xpath: step.xpath,
    text: renderedText.length > 0 ? renderedText : undefined,
    textMode: step.exact ? "exact" : "contains",
    visibility: step.visible ? { target: "visible" } : undefined,
    scopeKey: step.scopeKey,
    presenceThreshold: step.presenceThreshold ?? hints?.presenceThreshold,
    scrollerKey: step.scrollerKey ?? hints?.scrollerKey,
    maxResolverRetries: step.staleRetryCap,
    hints,
    timeoutMs: step.timeoutMs,
    intervalMs: step.intervalMs,
    debug: step.debug
  });

  return buildResult("success", {
    notes: step.name ?? "Wait condition satisfied",
    data: {
      wait: serializeWaitResult(execution.result, execution.options)
    }
  });
}

export function createWaitForHandler(options: ActionRuntimeOptions = {}): WorkflowStepHandler {
  return buildHandler<WaitForStep>((args, runtime) => executeWaitFor(args, runtime), options);
}
