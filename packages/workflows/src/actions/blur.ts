import { StepError } from "../engine/errors";
import {
  buildHandler,
  buildResult,
  isHTMLElement,
  type ActionExecutionArgs,
  type ActionRuntimeOptions
} from "./shared";
import type { BlurStep, WorkflowStepHandler } from "../types";

async function executeBlur(args: ActionExecutionArgs<BlurStep>) {
  const { step, resolveResult } = args;
  const element = resolveResult?.element ?? null;

  if (!element) {
    throw new StepError({
      reason: "resolver-miss",
      message: `Blur step could not resolve logical key '${step.key}'`,
      stepKind: step.kind,
      stepId: step.id,
      logicalKey: step.key
    });
  }

  if (!isHTMLElement(element) || typeof element.blur !== "function") {
    throw new StepError({
      reason: "unknown",
      message: "Resolved node cannot blur",
      stepKind: step.kind,
      stepId: step.id,
      logicalKey: step.key
    });
  }

  element.blur();

  return buildResult("success", {
    notes: step.name ?? `Blurred logical key '${step.key}'`
  });
}

export function createBlurHandler(options: ActionRuntimeOptions = {}): WorkflowStepHandler {
  return buildHandler(executeBlur, options);
}
