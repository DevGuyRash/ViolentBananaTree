import { wait } from "../../../core/utils/wait";
import { StepError } from "../engine/errors";
import {
  buildHandler,
  buildResult,
  isHTMLElement,
  maskValue,
  renderTemplate,
  resolveEnvValue,
  sanitizeEntry,
  withEnvironment,
  type ActionExecutionArgs,
  type ActionRuntimeOptions
} from "./shared";
import type { StepResult, TypeStep, WorkflowStepHandler } from "../types";

function resolveTypeValue(args: ActionExecutionArgs<TypeStep>, runtime: ActionRuntimeOptions): { value: string } {
  const { step } = args;
  const templateOptions = withEnvironment(args, runtime.environment);

  if (typeof step.fromCtx === "string" && step.fromCtx.length > 0) {
    const ctxValue = args.context.get(step.fromCtx);
    return {
      value: typeof ctxValue === "undefined" || ctxValue === null ? "" : String(ctxValue)
    };
  }

  if (typeof step.fromEnv === "string" && step.fromEnv.length > 0) {
    const envValue = resolveEnvValue(step.fromEnv, runtime.environment);
    return {
      value: typeof envValue === "undefined" ? "" : envValue
    };
  }

  return {
    value: renderTemplate(step.text, templateOptions)
  };
}

function applyTextToElement(element: HTMLElement, value: string, clearFirst?: boolean): void {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    if (clearFirst) {
      element.value = "";
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }

    element.focus?.();
    element.value = value;
    element.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertFromPaste" }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  if (element.isContentEditable) {
    element.focus?.();
    element.textContent = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  throw new StepError({
    reason: "unknown",
    message: "Element is not typeable",
    stepKind: "type"
  });
}

async function executeType(
  args: ActionExecutionArgs<TypeStep>,
  runtime: ActionRuntimeOptions
): Promise<StepResult> {
  const { step, resolveResult, signal } = args;
  const element = resolveResult?.element ?? null;

  if (!element) {
    throw new StepError({
      reason: "resolver-miss",
      message: `Type step could not resolve logical key '${step.key}'`,
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

  const { value } = resolveTypeValue(args, runtime);

  applyTextToElement(element, value, step.clearFirst);

  if (typeof step.delayMs === "number" && step.delayMs > 0) {
    await wait(step.delayMs, { signal });
  }

  const masked = step.maskOutput ? maskValue(value) : value;

  return buildResult("success", {
    notes: step.name ?? `Typed into logical key '${step.key}'`,
    data: {
      value: sanitizeEntry(step.maskOutput ? "masked" : "value", masked, step.maskOutput)
    }
  });
}

export function createTypeHandler(options: ActionRuntimeOptions = {}): WorkflowStepHandler {
  return buildHandler<TypeStep>((args, runtime) => executeType(args, runtime), options);
}
