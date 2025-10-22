import { StepError } from "../engine/errors";
import {
  buildHandler,
  buildResult,
  normalizeWhitespace,
  safeTextContent,
  sanitizeEntry,
  toContextUpdate,
  type ActionExecutionArgs,
  type ActionRuntimeOptions
} from "./shared";
import type { CollectListOptions, CollectListStep, WorkflowStepHandler } from "../types";

function extractAttrs(element: Element, attrs: string[] | undefined): Record<string, string | null> {
  if (!attrs || attrs.length === 0) {
    return Array.from(element.attributes).reduce<Record<string, string | null>>((acc, attr) => {
      acc[attr.name] = attr.value;
      return acc;
    }, {});
  }

  return attrs.reduce<Record<string, string | null>>((acc, attr) => {
    acc[attr] = element.getAttribute(attr);
    return acc;
  }, {});
}

function dedupeValues<T>(values: T[], strategy: CollectListOptions["dedupe"]): T[] {
  if (!strategy) {
    return values;
  }

  if (strategy === true) {
    return Array.from(new Set(values.map((value) => JSON.stringify(value)))).map((key) => JSON.parse(key) as T);
  }

  if (strategy.by === "text") {
    const seen = new Set<string>();
    return values.filter((value) => {
      const text = typeof value === "string" ? value : JSON.stringify(value);
      if (seen.has(text)) {
        return false;
      }
      seen.add(text);
      return true;
    });
  }

  if (strategy.by === "attr" && strategy.attr) {
    const seen = new Set<string>();
    return values.filter((value) => {
      const current = (value as Record<string, unknown>)[strategy.attr];
      const key = String(current ?? "");
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  return values;
}

function serializeItem(element: Element, options: CollectListOptions): unknown {
  switch (options.to ?? "text") {
    case "html":
      return element.innerHTML;
    case "attrs":
      return extractAttrs(element, options.attrs);
    case "object":
      return {
        text: safeTextContent(element),
        html: element.innerHTML,
        attrs: extractAttrs(element, options.attrs)
      };
    case "text":
    default:
      return normalizeWhitespace(safeTextContent(element));
  }
}

async function executeCollectList(args: ActionExecutionArgs<CollectListStep>) {
  const { step } = args;
  const parentResult = await args.resolveLogicalKey(step.options.parentKey);
  const parent = parentResult.element;

  if (!parent) {
    throw new StepError({
      reason: "resolver-miss",
      message: `CollectList parent '${step.options.parentKey}' not found`,
      stepKind: step.kind,
      stepId: step.id,
      logicalKey: step.options.parentKey
    });
  }

  let items: Element[] = [];

  if (step.options.itemCss) {
    items = Array.from(parent.querySelectorAll(step.options.itemCss));
  } else {
    items = Array.from(parent.children);
  }

  if (typeof step.options.limit === "number" && step.options.limit > 0) {
    items = items.slice(0, step.options.limit);
  }

  let values = items.map((item) => serializeItem(item, step.options));
  values = dedupeValues(values, step.options.dedupe ?? false);

  const data = {
    count: values.length
  } as Record<string, unknown>;

  if (Array.isArray(values)) {
    data.values = values;
  }

  const updates = step.toCtx
    ? [toContextUpdate(step.toCtx, values, undefined, false)]
    : undefined;

  return buildResult("success", {
    notes: step.name ?? "Collected list",
    contextUpdates: updates,
    data: {
      values: sanitizeEntry(step.toCtx ?? "values", values, false),
      count: values.length
    }
  });
}

export function createCollectListHandler(options: ActionRuntimeOptions = {}): WorkflowStepHandler {
  return buildHandler((args) => executeCollectList(args), options);
}
