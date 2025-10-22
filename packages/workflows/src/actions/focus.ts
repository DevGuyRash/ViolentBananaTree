import { StepError } from "../engine/errors";
import {
  buildHandler,
  buildResult,
  isHTMLElement,
  type ActionExecutionArgs,
  type ActionRuntimeOptions
} from "./shared";
import type { FocusStep, WorkflowStepHandler } from "../types";

async function executeFocus(args: ActionExecutionArgs<FocusStep>) {
  const { step, resolveResult } = args;
  const element = resolveResult?.element ?? null;

  if (!element) {
    throw new StepError({
      reason: "resolver-miss",
      message: `Focus step could not resolve logical key '${step.key}'`,
      stepKind: step.kind,
      stepId: step.id,
      logicalKey: step.key
    });
  }

  if (!isHTMLElement(element) || typeof element.focus !== "function") {
    throw new StepError({
      reason: "unknown",
      message: "Resolved node cannot receive focus",
      stepKind: step.kind,
      stepId: step.id,
      logicalKey: step.key
    });
  }

  element.focus();

  return buildResult("success", {
    notes: step.name ?? `Focused logical key '${step.key}'`
  });
}

export function createFocusHandler(options: ActionRuntimeOptions = {}): WorkflowStepHandler {
  return buildHandler(executeFocus, options);
}
