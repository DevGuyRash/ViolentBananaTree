import { test } from "node:test";
import assert from "node:assert/strict";

import {
  validateWorkflowDefinition,
  type WorkflowDefinition,
  type WorkflowStep,
  WORKFLOW_DEFAULT_TIMEOUT_MS
} from "../types";

function unwrapValid(result: ReturnType<typeof validateWorkflowDefinition>): WorkflowDefinition {
  if (!result.valid || !result.value) {
    const messages = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    throw new Error(`Expected definition to be valid but found issues: ${messages}`);
  }

  return result.value;
}

function collectErrors(result: ReturnType<typeof validateWorkflowDefinition>): string[] {
  return result.issues.filter((issue) => issue.severity === "error").map((issue) => `${issue.path}: ${issue.message}`);
}

function buildStep<T extends WorkflowStep>(step: T): T {
  return {
    timeoutMs: WORKFLOW_DEFAULT_TIMEOUT_MS,
    ...step
  } satisfies WorkflowStep as T;
}

test("validates control flow branches when structure is correct", () => {
  const definition: WorkflowDefinition = {
    id: "control-flow-valid",
    steps: [
      buildStep({
        kind: "if",
        when: { kind: "exists", key: "header.main" },
        then: [
          buildStep({
            kind: "foreach",
            list: "ctx.items",
            as: "item",
            steps: [
              buildStep({
                kind: "log",
                message: "processing"
              })
            ]
          })
        ],
        else: [
          buildStep({
            kind: "delay",
            ms: 100
          })
        ]
      })
    ]
  };

  const result = validateWorkflowDefinition(definition);

  assert.equal(result.valid, true);
  assert.deepEqual(result.issues.filter((issue) => issue.severity === "error"), []);
  assert.ok(result.value);
});

test("reports missing then branch for if step", () => {
  const definition: WorkflowDefinition = {
    id: "if-missing-then",
    steps: [
      buildStep({
        kind: "if",
        when: { kind: "exists", key: "header.main" },
        then: []
      })
    ]
  };

  const result = validateWorkflowDefinition(definition);
  const errors = collectErrors(result);

  assert.equal(result.valid, false);
  assert.ok(errors.some((message) => message.includes("root.steps[0].then")));
});

test("reports foreach validation errors", () => {
  const definition: WorkflowDefinition = {
    id: "foreach-invalid",
    steps: [
      buildStep({
        kind: "foreach",
        list: "", // invalid path
        as: "",
        steps: []
      })
    ]
  };

  const result = validateWorkflowDefinition(definition);
  const errors = collectErrors(result);

  assert.equal(result.valid, false);
  assert.ok(errors.some((message) => message.includes("root.steps[0].list")));
  assert.ok(errors.some((message) => message.includes("root.steps[0].as")));
  assert.ok(errors.some((message) => message.includes("root.steps[0].steps")));
});

test("requires concrete selectors for waitFor step", () => {
  const definition: WorkflowDefinition = {
    id: "waitfor-invalid",
    steps: [
      buildStep({
        kind: "waitFor"
      })
    ]
  };

  const result = validateWorkflowDefinition(definition);
  const errors = collectErrors(result);

  assert.equal(result.valid, false);
  assert.ok(errors.some((message) => message.includes("root.steps[0]")));
});

test("logical key validation emits warning without failing", () => {
  const definition: WorkflowDefinition = {
    id: "logical-key-warning",
    steps: [
      buildStep({
        kind: "click",
        key: "invalid css!"
      })
    ]
  };

  const result = validateWorkflowDefinition(definition);

  assert.equal(result.valid, true);
  const warnings = result.issues.filter((issue) => issue.severity === "warning");
  assert.ok(warnings.some((issue) => issue.path === "root.steps[0].key"));
});
