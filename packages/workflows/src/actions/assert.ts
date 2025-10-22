import { StepError } from "../engine/errors";
import {
  buildHandler,
  buildResult,
  matchesText,
  safeTextContent,
  type ActionExecutionArgs,
  type ActionRuntimeOptions
} from "./shared";
import type { Assertion, AssertStep, WorkflowStepHandler } from "../types";

async function assertExists(assertion: Assertion & { kind: "exists" }, args: ActionExecutionArgs<AssertStep>): Promise<void> {
  const result = await args.resolveLogicalKey(assertion.key);

  if (!result.element) {
    throw new StepError({
      reason: "assertion-failed",
      message: `Expected element '${assertion.key}' to exist`,
      stepKind: args.step.kind,
      stepId: args.step.id,
      logicalKey: assertion.key
    });
  }
}

async function assertNotExists(assertion: Assertion & { kind: "notExists" }, args: ActionExecutionArgs<AssertStep>): Promise<void> {
  const result = await args.resolveLogicalKey(assertion.key);

  if (result.element) {
    throw new StepError({
      reason: "assertion-failed",
      message: `Expected element '${assertion.key}' not to exist`,
      stepKind: args.step.kind,
      stepId: args.step.id,
      logicalKey: assertion.key
    });
  }
}

async function assertText(assertion: Assertion & { kind: "textContains" }, args: ActionExecutionArgs<AssertStep>): Promise<void> {
  const result = await args.resolveLogicalKey(assertion.key);
  const element = result.element;

  if (!element) {
    throw new StepError({
      reason: "assertion-failed",
      message: `Element '${assertion.key}' missing for text assertion`,
      stepKind: args.step.kind,
      stepId: args.step.id,
      logicalKey: assertion.key
    });
  }

  const actual = safeTextContent(element);
  const expected = String(assertion.text);

  if (!matchesText(actual, expected, { exact: assertion.exact, caseSensitive: assertion.caseSensitive })) {
    throw new StepError({
      reason: "assertion-failed",
      message: `Expected element '${assertion.key}' text to match '${expected}'`,
      stepKind: args.step.kind,
      stepId: args.step.id,
      logicalKey: assertion.key,
      data: {
        expected,
        actual
      }
    });
  }
}

async function assertAttr(assertion: Assertion & { kind: "attrEquals" }, args: ActionExecutionArgs<AssertStep>): Promise<void> {
  const result = await args.resolveLogicalKey(assertion.key);
  const element = result.element;

  if (!element) {
    throw new StepError({
      reason: "assertion-failed",
      message: `Element '${assertion.key}' missing for attribute assertion`,
      stepKind: args.step.kind,
      stepId: args.step.id,
      logicalKey: assertion.key
    });
  }

  const actual = element.getAttribute(assertion.attr);
  const expected = String(assertion.value);

  if (actual !== expected) {
    throw new StepError({
      reason: "assertion-failed",
      message: `Expected attribute '${assertion.attr}' to equal '${expected}'`,
      stepKind: args.step.kind,
      stepId: args.step.id,
      logicalKey: assertion.key,
      data: {
        expected,
        actual
      }
    });
  }
}

function assertCtxEquals(assertion: Assertion & { kind: "ctxEquals" }, args: ActionExecutionArgs<AssertStep>): void {
  const actual = args.context.get(assertion.path);

  if (actual !== assertion.value) {
    throw new StepError({
      reason: "assertion-failed",
      message: `Expected context '${assertion.path}' to equal provided value`,
      stepKind: args.step.kind,
      stepId: args.step.id,
      data: {
        expected: assertion.value,
        actual
      }
    });
  }
}

function assertCtxDefined(assertion: Assertion & { kind: "ctxDefined" }, args: ActionExecutionArgs<AssertStep>): void {
  if (typeof args.context.get(assertion.path) === "undefined") {
    throw new StepError({
      reason: "assertion-failed",
      message: `Expected context '${assertion.path}' to be defined`,
      stepKind: args.step.kind,
      stepId: args.step.id
    });
  }
}

function assertUrlIncludes(assertion: Assertion & { kind: "urlIncludes" }): void {
  const href = globalThis.location?.href ?? "";

  if (!href.includes(assertion.value)) {
    throw new StepError({
      reason: "assertion-failed",
      message: `Expected URL to include '${assertion.value}'`,
      stepKind: "assert",
      data: {
        expected: assertion.value,
        actual: href
      }
    });
  }
}

async function evaluateAssertion(assertion: Assertion, args: ActionExecutionArgs<AssertStep>): Promise<void> {
  switch (assertion.kind) {
    case "exists":
      await assertExists(assertion, args);
      return;
    case "notExists":
      await assertNotExists(assertion, args);
      return;
    case "textContains":
      await assertText(assertion, args);
      return;
    case "attrEquals":
      await assertAttr(assertion, args);
      return;
    case "ctxEquals":
      assertCtxEquals(assertion, args);
      return;
    case "ctxDefined":
      assertCtxDefined(assertion, args);
      return;
    case "urlIncludes":
      assertUrlIncludes(assertion);
      return;
    default:
      throw new StepError({
        reason: "assertion-failed",
        message: `Unsupported assertion '${(assertion as { kind: string }).kind}'`,
        stepKind: args.step.kind,
        stepId: args.step.id
      });
  }
}

async function executeAssert(args: ActionExecutionArgs<AssertStep>) {
  const { step } = args;
  await evaluateAssertion(step.check, args);

  return buildResult("success", {
    notes: step.name ?? "Assertion passed"
  });
}

export function createAssertHandler(options: ActionRuntimeOptions = {}): WorkflowStepHandler {
  return buildHandler((args) => executeAssert(args), options);
}
