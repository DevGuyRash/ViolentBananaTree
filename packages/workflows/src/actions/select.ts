import { StepError } from "../engine/errors";
import {
  buildHandler,
  buildResult,
  renderTemplate,
  resolveContextValue,
  resolveEnvValue,
  withEnvironment,
  type ActionExecutionArgs,
  type ActionRuntimeOptions
} from "./shared";
import type { SelectStep, WorkflowStepHandler } from "../types";

function toArrayValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry));
  }

  if (typeof value === "string") {
    return value.split(",").map((part) => part.trim()).filter(Boolean);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }

  return [];
}

function resolveSelectValues(args: ActionExecutionArgs<SelectStep>, runtime: ActionRuntimeOptions): string[] {
  const { step } = args;
  const templateOptions = withEnvironment(args, runtime.environment);

  if (typeof step.fromCtx === "string" && step.fromCtx.length > 0) {
    const ctxValue = resolveContextValue(args.context, step.fromCtx);
    return toArrayValue(ctxValue);
  }

  if (typeof step.fromEnv === "string" && step.fromEnv.length > 0) {
    const envValue = resolveEnvValue(step.fromEnv, runtime.environment);
    return toArrayValue(envValue);
  }

  if (typeof step.value === "string" && step.value.length > 0) {
    return [renderTemplate(step.value, templateOptions)];
  }

  return [];
}

function selectByValue(select: HTMLSelectElement, values: string[]): void {
  if (select.multiple) {
    const set = new Set(values);
    Array.from(select.options).forEach((option) => {
      option.selected = set.has(option.value);
    });
    return;
  }

  if (values.length > 0) {
    select.value = values[0];
  }
}

function selectByLabel(select: HTMLSelectElement, values: string[]): void {
  if (select.multiple) {
    const set = new Set(values.map((item) => item.toLowerCase()));
    Array.from(select.options).forEach((option) => {
      option.selected = set.has(option.text.toLowerCase());
    });
    return;
  }

  const target = values[0]?.toLowerCase();

  if (!target) {
    return;
  }

  const match = Array.from(select.options).find((option) => option.text.toLowerCase() === target);

  if (match) {
    select.value = match.value;
  }
}

function selectByIndex(select: HTMLSelectElement, values: string[]): void {
  const indices = values
    .map((value) => Number.parseInt(value, 10))
    .filter((index) => Number.isFinite(index) && index >= 0);

  if (select.multiple) {
    const set = new Set(indices);
    Array.from(select.options).forEach((option, index) => {
      option.selected = set.has(index);
    });
    return;
  }

  if (indices.length > 0) {
    const option = select.options[indices[0]];
    if (option) {
      select.value = option.value;
    }
  }
}

async function executeSelect(args: ActionExecutionArgs<SelectStep>, runtime: ActionRuntimeOptions) {
  const { step, resolveResult } = args;
  const element = resolveResult?.element ?? null;

  if (!element) {
    throw new StepError({
      reason: "resolver-miss",
      message: `Select step could not resolve logical key '${step.key}'`,
      stepKind: step.kind,
      stepId: step.id,
      logicalKey: step.key
    });
  }

  if (!(element instanceof HTMLSelectElement)) {
    throw new StepError({
      reason: "unknown",
      message: "Resolved node is not an HTMLSelectElement",
      stepKind: step.kind,
      stepId: step.id,
      logicalKey: step.key
    });
  }

  if (step.allowMultiple) {
    element.multiple = true;
  }

  const values = resolveSelectValues(args, runtime);

  switch (step.optionBy ?? "value") {
    case "label":
      selectByLabel(element, values);
      break;
    case "index":
      selectByIndex(element, values);
      break;
    default:
      selectByValue(element, values);
  }

  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));

  return buildResult("success", {
    notes: step.name ?? `Selected option on '${step.key}'`,
    data: {
      values
    }
  });
}

export function createSelectHandler(options: ActionRuntimeOptions = {}): WorkflowStepHandler {
  return buildHandler<SelectStep>((args, runtime) => executeSelect(args, runtime), options);
}
