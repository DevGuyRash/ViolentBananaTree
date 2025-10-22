import { StepError } from "../engine/errors";
import {
  buildHandler,
  buildResult,
  isHTMLElement,
  type ActionRuntimeOptions,
  type ActionExecutionArgs
} from "./shared";
import type { ClickStep, WorkflowStepHandler } from "../types";

function toMouseButton(button: ClickStep["button"] | undefined): number {
  switch (button) {
    case "secondary":
      return 2;
    case "auxiliary":
      return 1;
    default:
      return 0;
  }
}

function buildMouseInit(step: ClickStep): MouseEventInit {
  return {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: toMouseButton(step.button),
    detail: step.doubleClick ? 2 : 1,
    altKey: step.modifiers?.alt ?? false,
    ctrlKey: step.modifiers?.ctrl ?? false,
    metaKey: step.modifiers?.meta ?? false,
    shiftKey: step.modifiers?.shift ?? false
  } satisfies MouseEventInit;
}

async function executeClick(args: ActionExecutionArgs<ClickStep>): Promise<ReturnType<typeof buildResult>> {
  const { step, resolveResult } = args;
  const element = resolveResult?.element ?? null;

  if (!element) {
    throw new StepError({
      reason: "resolver-miss",
      message: `Click step could not resolve logical key '${step.key}'`,
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

  const init = buildMouseInit(step);
  const events: Array<keyof HTMLElementEventMap> = ["pointerdown", "mousedown", "mouseup", "click"];

  if (step.doubleClick) {
    events.push("dblclick");
  }

  events.forEach((type) => {
    const event = new MouseEvent(type, init);
    element.dispatchEvent(event);
  });

  if (typeof element.focus === "function") {
    element.focus();
  }

  return buildResult("success", {
    notes: step.name ?? `Clicked logical key '${step.key}'`
  });
}

export function createClickHandler(options: ActionRuntimeOptions = {}): WorkflowStepHandler {
  return buildHandler(executeClick, options);
}
