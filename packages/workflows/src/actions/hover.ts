import { StepError } from "../engine/errors";
import {
  buildHandler,
  buildResult,
  isHTMLElement,
  type ActionRuntimeOptions,
  type ActionExecutionArgs
} from "./shared";
import type { HoverStep, WorkflowStepHandler } from "../types";

async function executeHover(args: ActionExecutionArgs<HoverStep>) {
  const { step, resolveResult } = args;
  const element = resolveResult?.element ?? null;

  if (!element) {
    throw new StepError({
      reason: "resolver-miss",
      message: `Hover step could not resolve logical key '${step.key}'`,
      stepKind: step.kind,
      stepId: step.id,
      logicalKey: step.key
    });
  }

  if (!isHTMLElement(element)) {
    throw new StepError({
      reason: "unknown",
      message: "Resolved node is not an HTMLElement",
      stepKind: step.kind,
      stepId: step.id,
      logicalKey: step.key
    });
  }

  const pointer = new MouseEvent("pointerover", { bubbles: true, cancelable: true, composed: true });
  element.dispatchEvent(pointer);
  element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, composed: true }));

  return buildResult("success", {
    notes: step.name ?? `Hovered logical key '${step.key}'`
  });
}

export function createHoverHandler(options: ActionRuntimeOptions = {}): WorkflowStepHandler {
  return buildHandler(executeHover, options);
}
