import { StepError } from "../engine/errors";
import {
  buildHandler,
  buildResult,
  isVisible,
  pollUntil,
  renderTemplate,
  safeTextContent,
  withEnvironment,
  type ActionExecutionArgs,
  type ActionRuntimeOptions
} from "./shared";
import type { WaitForStep, WorkflowStepHandler } from "../types";

function queryByXpath(expression: string, root: Document | Element | null): Element | null {
  if (!root) {
    return null;
  }

  const doc = root.ownerDocument ?? (root as Document);
  try {
    const result = doc.evaluate(expression, root, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    const node = result.singleNodeValue;
    return node instanceof Element ? node : null;
  } catch {
    return null;
  }
}

function evaluateCondition(step: WaitForStep, root: Document | Element | null, expectedText?: string): boolean {
  if (step.key) {
    const element = root as Element | null;
    if (!element) {
      return false;
    }

    if (step.visible) {
      return isVisible(element);
    }

    if (expectedText) {
      const actual = safeTextContent(element);
      return step.exact ? actual === expectedText : actual.includes(expectedText);
    }

    return true;
  }

  return false;
}

async function executeWaitFor(args: ActionExecutionArgs<WaitForStep>, runtime: ActionRuntimeOptions) {
  const { step, resolveResult, signal } = args;
  const templateOptions = withEnvironment(args, runtime.environment);
  const documentRoot = resolveResult?.element?.ownerDocument ?? globalThis.document ?? null;
  const renderedText = renderTemplate(step.text, templateOptions);

  const success = await pollUntil(() => {
    if (step.key) {
      const element = resolveResult?.element ?? null;
      if (!element) {
        return false;
      }

      if (step.visible && !isVisible(element)) {
        return false;
      }

      if (renderedText) {
        const actual = safeTextContent(element);
        return step.exact ? actual === renderedText : actual.includes(renderedText);
      }

      return true;
    }

    if (step.css && documentRoot) {
      const element = documentRoot.querySelector(step.css);
      if (!element) {
        return false;
      }

      if (step.visible && !isVisible(element)) {
        return false;
      }

      if (renderedText) {
        const actual = safeTextContent(element);
        return step.exact ? actual === renderedText : actual.includes(renderedText);
      }

      return true;
    }

    if (step.xpath && documentRoot) {
      const element = queryByXpath(step.xpath, documentRoot);

      if (!element) {
        return false;
      }

      if (step.visible && !isVisible(element)) {
        return false;
      }

      if (renderedText) {
        const actual = safeTextContent(element);
        return step.exact ? actual === renderedText : actual.includes(renderedText);
      }

      return true;
    }

    if (renderedText && documentRoot) {
      const container = documentRoot instanceof Document ? documentRoot.body : documentRoot;
      const content = safeTextContent(container);
      return step.exact ? content === renderedText : content.includes(renderedText);
    }

    return false;
  }, {
    timeoutMs: step.timeoutMs,
    intervalMs: step.intervalMs,
    signal
  });

  if (!success) {
    throw new StepError({
      reason: "timeout",
      message: "waitFor condition not satisfied before timeout",
      stepKind: step.kind,
      stepId: step.id,
      logicalKey: step.key
    });
  }

  return buildResult("success", {
    notes: step.name ?? "Wait condition satisfied"
  });
}

export function createWaitForHandler(options: ActionRuntimeOptions = {}): WorkflowStepHandler {
  return buildHandler((args, runtime) => executeWaitFor(args, runtime), options);
}
