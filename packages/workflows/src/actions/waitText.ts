import { StepError } from "../engine/errors";
import {
  buildHandler,
  buildResult,
  matchesText,
  pollUntil,
  renderTemplate,
  safeTextContent,
  withEnvironment,
  type ActionExecutionArgs,
  type ActionRuntimeOptions
} from "./shared";
import type { WaitTextStep, WorkflowStepHandler } from "../types";

function findScopeElement(key: string | undefined, root: Document | null): Element | null {
  if (!key || !root) {
    return root?.body ?? null;
  }

  const selectors = [`[data-dgx-key="${key}"]`, `[data-logical-key="${key}"]`];

  for (const selector of selectors) {
    const match = root.querySelector(selector);
    if (match) {
      return match;
    }
  }

  return root.body ?? null;
}

async function executeWaitText(args: ActionExecutionArgs<WaitTextStep>, runtime: ActionRuntimeOptions) {
  const { step, resolveResult, signal } = args;
  const templateOptions = withEnvironment(args, runtime.environment);
  const documentRoot = resolveResult?.element?.ownerDocument ?? globalThis.document ?? null;
  const expected = renderTemplate(step.text, templateOptions);

  const success = await pollUntil(() => {
    const scope = findScopeElement(step.withinKey, documentRoot);

    if (!scope) {
      return false;
    }

    const content = safeTextContent(scope);

    return matchesText(content, expected, {
      exact: step.exact,
      caseSensitive: step.caseSensitive
    });
  }, {
    timeoutMs: step.timeoutMs,
    intervalMs: step.intervalMs,
    signal
  });

  if (!success) {
    throw new StepError({
      reason: "timeout",
      message: "waitText condition not satisfied before timeout",
      stepKind: step.kind,
      stepId: step.id
    });
  }

  return buildResult("success", {
    notes: step.name ?? "Text condition satisfied"
  });
}

export function createWaitTextHandler(options: ActionRuntimeOptions = {}): WorkflowStepHandler {
  return buildHandler((args, runtime) => executeWaitText(args, runtime), options);
}
