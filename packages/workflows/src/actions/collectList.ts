import { StepError } from "../engine/errors";
import {
  buildHandler,
  buildResult,
  normalizeWhitespace,
  safeTextContent,
  sanitizeEntry,
  sanitizeForLogging,
  toContextUpdate,
  type ActionExecutionArgs,
  type ActionRuntimeOptions
} from "./shared";
import type {
  CollectListMapper,
  CollectListOptions,
  CollectListStep,
  StepResult,
  WorkflowStepHandler
} from "../types";

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
    const attrName = strategy.attr;
    const seen = new Set<string>();
    return values.filter((value) => {
      const current = (value as Record<string, unknown>)[attrName];
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

function isDescendant(parent: Element, candidate: Element): boolean {
  if (parent === candidate) {
    return true;
  }

  const contains = (parent as { contains?: (node: Element | null) => boolean }).contains;
  if (typeof contains === "function") {
    return contains.call(parent, candidate);
  }

  let current: Element | null | undefined = candidate;

  while (current) {
    const next = (current as { parentElement?: Element | null }).parentElement;
    if (!next) {
      break;
    }
    if (next === parent) {
      return true;
    }
    current = next;
  }

  return false;
}

function uniqueElements(elements: Element[]): Element[] {
  const seen = new Set<Element>();
  return elements.filter((element) => {
    if (seen.has(element)) {
      return false;
    }
    seen.add(element);
    return true;
  });
}

async function resolveItems(
  args: ActionExecutionArgs<CollectListStep>,
  parent: Element,
  options: CollectListOptions
): Promise<Element[]> {
  const items: Element[] = [];

  if (options.itemKey) {
    const result = await args.resolveLogicalKey(options.itemKey);
    const attempts = Array.isArray(result.attempts) ? result.attempts : [];
    const prioritized: typeof attempts = [];

    if (result.resolvedBy) {
      const resolvedAttempt = attempts.find((attempt) => attempt.strategy === result.resolvedBy);
      if (resolvedAttempt) {
        prioritized.push(resolvedAttempt);
      }
    }

    attempts.forEach((attempt) => {
      if (!attempt.success) {
        return;
      }
      if (prioritized.includes(attempt)) {
        return;
      }
      prioritized.push(attempt);
    });

    prioritized
      .map((attempt) => attempt.elements ?? [])
      .flat()
      .forEach((element) => {
        if (element && isDescendant(parent, element)) {
          items.push(element);
        }
      });

    if (items.length === 0 && result.element && isDescendant(parent, result.element)) {
      items.push(result.element);
    }
  }

  if (items.length === 0 && options.itemCss && typeof parent.querySelectorAll === "function") {
    try {
      items.push(...Array.from(parent.querySelectorAll(options.itemCss)));
    } catch {
      // ignore selector errors and fall through to children fallback
    }
  }

  if (items.length === 0) {
    const { children } = parent as { children?: Iterable<Element> };
    if (children) {
      items.push(...Array.from(children));
    }
  }

  return uniqueElements(items);
}

function resolveMapper(
  step: CollectListStep,
  args: ActionExecutionArgs<CollectListStep>
): CollectListMapper | null {
  if (typeof step.options.map === "function") {
    return step.options.map;
  }

  if (!step.options.mapCtx) {
    return null;
  }

  const candidate = args.context.get(step.options.mapCtx);

  if (typeof candidate === "function") {
    return candidate as CollectListMapper;
  }

  if (candidate && typeof candidate === "object" && typeof (candidate as { map?: unknown }).map === "function") {
    const mapper = (candidate as { map: CollectListMapper }).map;
    return mapper.bind(candidate) as CollectListMapper;
  }

  return null;
}

function mapValues(
  items: Element[],
  mapper: CollectListMapper | null,
  options: CollectListOptions,
  parent: Element,
  args: ActionExecutionArgs<CollectListStep>
): unknown[] {
  return items.map((element, index) => {
    if (mapper) {
      try {
        const mapped = mapper(element, {
          index,
          parent,
          context: args.context
        });

        if (typeof mapped !== "undefined") {
          return mapped;
        }
      } catch (error) {
        throw StepError.fromUnknown(args.step, "unknown", error, {
          data: {
            stage: "collectList.map",
            index
          }
        });
      }
    }

    return serializeItem(element, options);
  });
}

async function executeCollectList(
  args: ActionExecutionArgs<CollectListStep>,
  _runtime: ActionRuntimeOptions
): Promise<StepResult> {
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

  let items = await resolveItems(args, parent, step.options);

  if (typeof step.options.limit === "number" && step.options.limit > 0) {
    items = items.slice(0, step.options.limit);
  }

  const mapper = resolveMapper(step, args);

  let values = mapValues(items, mapper, step.options, parent, args);
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

  const sanitizedValues = sanitizeForLogging(values);

  return buildResult("success", {
    notes: step.name ?? "Collected list",
    contextUpdates: updates,
    data: {
      values: sanitizeEntry(step.toCtx ?? "values", sanitizedValues, false),
      count: values.length
    }
  });
}

export function createCollectListHandler(options: ActionRuntimeOptions = {}): WorkflowStepHandler {
  return buildHandler<CollectListStep>((args, runtime) => executeCollectList(args, runtime), options);
}
