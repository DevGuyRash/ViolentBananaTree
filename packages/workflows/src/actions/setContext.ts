import { StepError } from "../engine/errors";
import {
  buildHandler,
  buildResult,
  renderTemplate,
  resolveContextValue,
  resolveEnvValue,
  safeTextContent,
  sanitizeEntry,
  toContextUpdate,
  withEnvironment,
  type ActionExecutionArgs,
  type ActionRuntimeOptions
} from "./shared";
import type { ContextValueSource, SetContextStep, WorkflowStepHandler } from "../types";

async function resolveSourceValue(
  source: ContextValueSource | undefined,
  args: ActionExecutionArgs<SetContextStep>,
  runtime: ActionRuntimeOptions
): Promise<unknown> {
  if (!source) {
    return undefined;
  }

  switch (source.kind) {
    case "literal":
      return source.value;
    case "ctx":
      return resolveContextValue(args.context, source.path);
    case "env":
      return resolveEnvValue(source.name, runtime.environment);
    case "key": {
      const result = await args.resolveLogicalKey(source.key);
      const element = result.element;

      if (!element) {
        return undefined;
      }

      if (source.text) {
        return safeTextContent(element);
      }

      if (source.attr) {
        return element.getAttribute(source.attr) ?? undefined;
      }

      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        return element.value;
      }

      return safeTextContent(element);
    }
    default:
      throw new StepError({
        reason: "context-miss",
        message: `Unsupported context source '${(source as { kind: string }).kind}'`,
        stepKind: args.step.kind,
        stepId: args.step.id
      });
  }
}

async function executeSetContext(args: ActionExecutionArgs<SetContextStep>, runtime: ActionRuntimeOptions) {
  const { step } = args;
  const templateOptions = withEnvironment(args, runtime.environment);

  const resolvedValue = await (async () => {
    if (step.source) {
      return resolveSourceValue(step.source, args, runtime);
    }

    if (typeof step.value !== "undefined") {
      if (typeof step.value === "string") {
        return renderTemplate(step.value, templateOptions);
      }

      return step.value;
    }

    return "";
  })();

  const update = toContextUpdate(step.path, resolvedValue, step.ttlMs, step.mask);

  return buildResult("success", {
    notes: step.name ?? `Context set '${step.path}'`,
    contextUpdates: [update],
    data: {
      value: sanitizeEntry(step.path, resolvedValue, step.mask)
    }
  });
}

export function createSetContextHandler(options: ActionRuntimeOptions = {}): WorkflowStepHandler {
  return buildHandler<SetContextStep>((args, runtime) => executeSetContext(args, runtime), options);
}
