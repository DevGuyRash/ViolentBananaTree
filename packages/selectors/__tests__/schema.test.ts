import {
  SelectorSchemaError,
  loadSelectorMap,
  validateSelectorMap
} from "../schema";
import type { SelectorMap } from "../types";

type AsyncTest = () => void | Promise<void>;

const tests = new Map<string, AsyncTest>();

function test(name: string, fn: AsyncTest): void {
  tests.set(name, fn);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function createValidMap(): SelectorMap {
  return {
    submitButton: {
      description: "Primary submit button",
      stabilityScore: 0.8,
      tries: [
        {
          type: "role",
          role: "button",
          name: "Submit"
        },
        {
          type: "css",
          selector: ".submit"
        }
      ]
    },
    scopeExample: {
      scopeKey: "submitButton",
      tries: [
        {
          type: "css",
          selector: ".child"
        }
      ]
    }
  } satisfies SelectorMap;
}

test("loadSelectorMap returns typed entries for valid schema", () => {
  const map = createValidMap();
  const json = JSON.stringify(map);

  const loaded = loadSelectorMap(json);

  assert(Object.keys(loaded).length === 2, "expected two entries");
  const submit = loaded.submitButton;
  assert(submit.tries.length === 2, "submitButton should keep two strategies");
  assert(submit.tries[0].type === "role", "first strategy must be role");
});

test("validateSelectorMap detects out-of-order strategies", () => {
  const invalid = {
    key: {
      tries: [
        { type: "css", selector: ".primary" },
        { type: "role", role: "button" }
      ]
    }
  } satisfies Record<string, unknown>;

  let error: SelectorSchemaError | null = null;
  try {
    validateSelectorMap(invalid);
  } catch (err) {
    error = err as SelectorSchemaError;
  }

  assert(error instanceof SelectorSchemaError, "expected schema error for invalid order");
  const orderIssue = error.issues.find((issue) => issue.message.includes("canonical order"));
  assert(orderIssue, "error should mention canonical order violation");
});

test("validateSelectorMap reports missing scope references", () => {
  const invalid = {
    child: {
      scopeKey: "missing",
      tries: [
        {
          type: "css",
          selector: ".child"
        }
      ]
    }
  } satisfies Record<string, unknown>;

  let error: SelectorSchemaError | null = null;
  try {
    validateSelectorMap(invalid);
  } catch (err) {
    error = err as SelectorSchemaError;
  }

  assert(error instanceof SelectorSchemaError, "expected schema error for missing scope");
  const scopeIssue = error.issues.find((issue) => issue.path.includes("scopeKey"));
  assert(scopeIssue, "missing scope should surface scopeKey path");
});

async function run(): Promise<void> {
  for (const [name, fn] of tests.entries()) {
    try {
      await fn();
      console.log(`✓ ${name}`);
    } catch (error) {
      console.error(`✗ ${name}`);
      throw error;
    }
  }
}

declare const process: { exit(code?: number): never };

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
