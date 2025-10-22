import { wait } from "../../../core/utils/wait";
import { StepError } from "../engine/errors";
import {
  buildHandler,
  buildResult,
  pollUntil,
  type ActionExecutionArgs,
  type ActionRuntimeOptions
} from "./shared";
import type { ScrollUntilOptions, ScrollUntilStep, WorkflowStepHandler } from "../types";

async function resolveContainer(options: ScrollUntilOptions, args: ActionExecutionArgs<ScrollUntilStep>) {
  if (options.containerKey) {
    const result = await args.resolveLogicalKey(options.containerKey);
    if (result.element instanceof HTMLElement) {
      return result.element;
    }
  }

  return (globalThis.document?.scrollingElement as HTMLElement | null) ?? (globalThis.document?.documentElement as HTMLElement | null);
}

async function conditionMet(options: ScrollUntilOptions, args: ActionExecutionArgs<ScrollUntilStep>): Promise<boolean> {
  switch (options.until.kind) {
    case "end": {
      const container = await resolveContainer(options, args);
      if (!container) {
        return true;
      }
      return container.scrollTop + container.clientHeight >= container.scrollHeight;
    }
    case "element": {
      if (options.until.key) {
        const result = await args.resolveLogicalKey(options.until.key);
        return Boolean(result.element);
      }
      if (options.until.css) {
        return Boolean(globalThis.document?.querySelector(options.until.css));
      }
      if (options.until.xpath) {
        try {
          const doc = globalThis.document;
          if (!doc) {
            return false;
          }
          const match = doc.evaluate(options.until.xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          return match.singleNodeValue instanceof Element;
        } catch {
          return false;
        }
      }
      return false;
    }
    default:
      throw new StepError({
        reason: "unknown",
        message: `Unsupported scrollUntil condition '${(options.until as { kind: string }).kind}'`,
        stepKind: args.step.kind,
        stepId: args.step.id
      });
  }
}

async function executeScrollUntil(args: ActionExecutionArgs<ScrollUntilStep>) {
  const { step, signal } = args;
  const container = await resolveContainer(step.options, args);

  if (!container) {
    throw new StepError({
      reason: "unknown",
      message: "No scroll container available",
      stepKind: step.kind,
      stepId: step.id
    });
  }

  const stepPx = step.options.stepPx ?? 200;
  const maxSteps = Math.max(1, step.options.maxSteps ?? 25);
  const delay = Math.max(0, step.options.delayMs ?? 0);

  for (let index = 0; index < maxSteps; index += 1) {
    if (await conditionMet(step.options, args)) {
      return buildResult("success", {
        notes: step.name ?? "Scroll condition met"
      });
    }

    container.scrollBy?.(0, stepPx);

    if (delay > 0) {
      await wait(delay, { signal });
    }
  }

  if (await conditionMet(step.options, args)) {
    return buildResult("success", {
      notes: step.name ?? "Scroll condition met"
    });
  }

  throw new StepError({
    reason: "timeout",
    message: "scrollUntil condition not met",
    stepKind: step.kind,
    stepId: step.id
  });
}

export function createScrollUntilHandler(options: ActionRuntimeOptions = {}): WorkflowStepHandler {
  return buildHandler((args) => executeScrollUntil(args), options);
}
