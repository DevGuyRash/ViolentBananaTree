import { StepError } from "../engine/errors";
import {
  buildHandler,
  buildResult,
  maskValue,
  safeTextContent,
  sanitizeEntry,
  toContextUpdate,
  type ActionExecutionArgs,
  type ActionRuntimeOptions
} from "./shared";
import type { CaptureStep, StepResult, WorkflowStepHandler } from "../types";

function extractValue(step: CaptureStep, element: Element | null): unknown {
  if (!element) {
    return undefined;
  }

  switch (step.from.kind) {
    case "text":
      return safeTextContent(element);
    case "attr":
      return element.getAttribute(step.from.attr) ?? undefined;
    case "html":
      return element.innerHTML;
    case "value":
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        return element.value;
      }
      return (element as HTMLElement).getAttribute("value") ?? safeTextContent(element);
    case "regex": {
      const source = step.from.attr ? element.getAttribute(step.from.attr) ?? "" : safeTextContent(element);
      try {
        const regexp = new RegExp(step.from.pattern, "g");
        const match = regexp.exec(source);

        if (!match) {
          return undefined;
        }

        const groupIndex = typeof step.from.group === "number" ? step.from.group : 0;
        return match[groupIndex] ?? undefined;
      } catch {
        return undefined;
      }
    }
    default:
      return undefined;
  }
}

async function executeCapture(
  args: ActionExecutionArgs<CaptureStep>,
  _runtime: ActionRuntimeOptions
): Promise<StepResult> {
  const { step } = args;
  const result = await args.resolveLogicalKey(step.from.key);
  const element = result.element;

  if (!element) {
    throw new StepError({
      reason: "resolver-miss",
      message: `Capture step could not resolve logical key '${step.from.key}'`,
      stepKind: step.kind,
      stepId: step.id,
      logicalKey: step.from.key
    });
  }

  const value = extractValue(step, element);
  const sanitized = step.sanitize ? maskValue(value) : value;

  const update = toContextUpdate(step.to, sanitized, undefined, step.sanitize);

  return buildResult("success", {
    notes: step.name ?? `Captured '${step.to}'`,
    contextUpdates: [update],
    data: {
      value: sanitizeEntry(step.to, sanitized, step.sanitize)
    }
  });
}

export function createCaptureHandler(options: ActionRuntimeOptions = {}): WorkflowStepHandler {
  return buildHandler<CaptureStep>(executeCapture, options);
}
