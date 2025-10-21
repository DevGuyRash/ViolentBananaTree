import { runWorkflow, WorkflowResolverMissError, WorkflowStepExecutionError } from "../engine";
import { InMemoryWorkflowContext, type WorkflowDefinition } from "../types";
import type { SelectorMap } from "../../selectors/types";
import type { ResolveResult } from "../../core/resolve";
import type {
  ResolverAttemptSummary,
  ResolverMissEvent,
  ResolverSuccessEvent,
  ResolverTelemetry
} from "../../core/resolve-telemetry";
import type { BackoffOptions } from "../../core/utils/wait";

type AsyncTest = () => Promise<void>;

const tests = new Map<string, AsyncTest>();

function test(name: string, fn: AsyncTest): void {
  tests.set(name, fn);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

type LogEntry = {
  level: string;
  message: string;
  data?: unknown;
};

function createLogger(entries: LogEntry[]) {
  return {
    debug(message: string, data?: unknown, _context?: unknown) {
      entries.push({ level: "debug", message, data });
    },
    info(message: string, data?: unknown, _context?: unknown) {
      entries.push({ level: "info", message, data });
    },
    warn(message: string, data?: unknown, _context?: unknown) {
      entries.push({ level: "warn", message, data });
    },
    error(message: string, data?: unknown, _context?: unknown) {
      entries.push({ level: "error", message, data });
    }
  } satisfies typeof import("../../core/debug");
}

function createSelectorMap(): SelectorMap {
  return {
    submitButton: {
      tries: [
        {
          type: "role",
          role: "button",
          name: "Submit"
        }
      ]
    }
  };
}

async function withFakeDocument<T>(
  query: (selector: string) => Element[],
  run: () => Promise<T> | T
): Promise<T> {
  const originalDocument = globalThis.document;

  const fakeDocument = {
    querySelectorAll: (selector: string) => query(selector)
  } as unknown as Document;

  globalThis.document = fakeDocument;

  try {
    return await run();
  } finally {
    globalThis.document = originalDocument;
  }
}

function buildSuccessResult(map: SelectorMap): ResolveResult {
  return {
    key: "submitButton",
    element: {} as Element,
    attempts: [
      {
        strategy: map.submitButton.tries[0],
        success: true,
        elements: [{} as Element]
      }
    ],
    resolvedBy: map.submitButton.tries[0],
    scope: undefined,
    entry: map.submitButton
  };
}

function buildMissResult(map: SelectorMap): ResolveResult {
  return {
    key: "submitButton",
    element: null,
    attempts: [
      {
        strategy: map.submitButton.tries[0],
        success: false,
        elements: []
      }
    ],
    resolvedBy: undefined,
    scope: undefined,
    entry: map.submitButton
  };
}

function createTelemetryTracker() {
  const attempts: ResolverAttemptSummary[] = [];
  const successEvents: ResolverSuccessEvent[] = [];
  const missEvents: ResolverMissEvent[] = [];

  const telemetry: ResolverTelemetry = {
    logAttempt(event) {
      attempts.push({
        attemptIndex: event.attemptIndex,
        strategyType: event.strategyType,
        success: event.success,
        elementCount: event.elementCount,
        stabilityScore: event.stabilityScore,
        uniqueInScope: event.uniqueInScope,
        tags: event.tags
      });
    },
    logSuccess(event) {
      successEvents.push(event);
    },
    logMiss(event) {
      missEvents.push(event);
    }
  };

  return { telemetry, attempts, successEvents, missEvents };
}

test("runs workflow step when resolver succeeds", async () => {
  const map = createSelectorMap();
  const context = new InMemoryWorkflowContext({ preserved: true });
  const tracker = createTelemetryTracker();
  const logs: LogEntry[] = [];
  const logger = createLogger(logs);

  let handlerCalls = 0;
  let receivedResult: ResolveResult | null = null;
  let receivedRetriesRemaining = -1;

  const workflow: WorkflowDefinition = {
    id: "success-workflow",
    steps: [
      {
        kind: "click",
        key: "submitButton"
      }
    ]
  };

  const successResult = buildSuccessResult(map);

  const result = await runWorkflow(workflow, {
    selectorMap: map,
    handlers: {
      click({ resolveResult, retriesRemaining, context: ctx }) {
        handlerCalls += 1;
        receivedResult = resolveResult;
        receivedRetriesRemaining = retriesRemaining;
        ctx.set("clicked", true);
      }
    },
    context,
    telemetry: tracker.telemetry,
    logger,
    resolve(_map, _key, options) {
      assert(options.telemetry === tracker.telemetry, "resolver should use provided telemetry instance");
      assert(options.logger === logger, "resolver should use provided logger instance");
      return successResult;
    }
  });

  assert(result.status === "success", "workflow should succeed");
  assert(handlerCalls === 1, "handler should run once");
  assert(receivedResult === successResult, "handler should receive resolve result");
  assert(receivedRetriesRemaining === 0, "retries should be zero on first success");
  assert(result.context.clicked === true, "context should store handler changes");
  assert(result.context.preserved === true, "context should preserve prior data");
  const infoLog = logs.find((entry) => entry.level === "info" && entry.message === "Workflow resolver success");
  assert(infoLog, "success should log resolved strategy");
  assert(tracker.successEvents.length === 0, "manual resolver should not emit telemetry unless triggered");
});

test("retries on resolver miss without clearing context", async () => {
  const map = createSelectorMap();
  const context = new InMemoryWorkflowContext({ attempts: 0, preserved: "value" });
  const tracker = createTelemetryTracker();
  const logs: LogEntry[] = [];
  const logger = createLogger(logs);

  let handlerCalls = 0;
  let resolveCalls = 0;

  const workflow: WorkflowDefinition = {
    id: "retry-workflow",
    steps: [
      {
        kind: "click",
        key: "submitButton",
        retries: 1,
        backoffMs: 0,
        jitterMs: 0
      }
    ]
  };

  const missResult = buildMissResult(map);
  const successResult = buildSuccessResult(map);

  const result = await runWorkflow(workflow, {
    selectorMap: map,
    handlers: {
      click({ context: ctx }) {
        handlerCalls += 1;
        const current = (ctx.get<number>("attempts") ?? 0) + 1;
        ctx.set("attempts", current);
      }
    },
    context,
    telemetry: tracker.telemetry,
    logger,
    resolve(_map, _key, options) {
      resolveCalls += 1;

      if (resolveCalls === 1) {
        options.telemetry?.logMiss({
          key: "submitButton",
          attemptCount: 1,
          attempts: missResult.attempts.map((attempt) => ({
            attemptIndex: 0,
            strategyType: attempt.strategy.type,
            success: attempt.success,
            elementCount: attempt.elements.length
          })),
          source: "workflow-engine"
        });
        return missResult;
      }

      options.telemetry?.logSuccess({
        key: "submitButton",
        scopeKey: undefined,
        strategyType: successResult.resolvedBy?.type ?? "role",
        attemptIndex: 0,
        attemptCount: 1,
        stabilityScore: undefined,
        tags: undefined,
        source: "workflow-engine"
      });

      return successResult;
    },
    backoff: {
      initialDelayMs: 0,
      maxDelayMs: 1,
      factor: 1,
      jitterMs: 0
    } satisfies BackoffOptions
  });

  assert(result.status === "success", "workflow should succeed after retry");
  assert(resolveCalls === 2, "resolver should be called twice");
  assert(handlerCalls === 1, "handler should run once after success");
  assert(result.context.attempts === 1, "context updates should persist");
  assert(result.context.preserved === "value", "context data must remain intact");
  const missLog = logs.find((entry) => entry.level === "warn" && entry.message === "Workflow resolver miss");
  assert(missLog, "miss attempt should be logged");
  assert(tracker.missEvents.length === 1, "telemetry should record miss event");
});

test("reports failure after exhausting retries", async () => {
  const map = createSelectorMap();
  const context = new InMemoryWorkflowContext({ untouched: true });
  const tracker = createTelemetryTracker();
  const logs: LogEntry[] = [];
  const logger = createLogger(logs);

  let resolveCalls = 0;

  const workflow: WorkflowDefinition = {
    id: "fail-workflow",
    steps: [
      {
        kind: "click",
        key: "submitButton",
        retries: 1,
        backoffMs: 0,
        jitterMs: 0
      }
    ]
  };

  const missResult = buildMissResult(map);

  const result = await runWorkflow(workflow, {
    selectorMap: map,
    handlers: {
      click() {
        throw new Error("handler should not execute on miss");
      }
    },
    context,
    telemetry: tracker.telemetry,
    logger,
    resolve(_map, _key, options) {
      resolveCalls += 1;
      options.telemetry?.logMiss({
        key: "submitButton",
        attemptCount: missResult.attempts.length,
        attempts: missResult.attempts.map((attempt, index) => ({
          attemptIndex: index,
          strategyType: attempt.strategy.type,
          success: attempt.success,
          elementCount: attempt.elements.length
        })),
        source: "workflow-engine"
      });
      return missResult;
    },
    backoff: {
      initialDelayMs: 0,
      maxDelayMs: 1,
      factor: 1,
      jitterMs: 0
    }
  });

  assert(result.status === "failed", "workflow should fail after retries");
  assert(result.error instanceof WorkflowStepExecutionError, "error should wrap step failure");
  const finalError = result.error as WorkflowStepExecutionError;
  assert(result.context.untouched === true, "context should remain untouched after failure");
  assert(resolveCalls === 2, "resolver should exhaust retries");
  assert(tracker.missEvents.length === 2, "telemetry should capture miss attempts");
  assert(finalError.cause instanceof WorkflowResolverMissError, "final error should retain miss cause");
});

test("integrates resolver output with engine retry loop", async () => {
  const map = {
    submitButton: {
      tries: [
        {
          type: "css",
          selector: ".submit"
        }
      ]
    }
  } satisfies SelectorMap;

  const context = new InMemoryWorkflowContext({ preserved: "value" });
  const tracker = createTelemetryTracker();
  const logs: LogEntry[] = [];
  const logger = createLogger(logs);

  const element = { id: "submit" } as unknown as Element;
  let queryCalls = 0;

  const workflow: WorkflowDefinition = {
    id: "integrated-resolver",
    steps: [
      {
        kind: "click",
        key: "submitButton",
        retries: 1,
        backoffMs: 0,
        jitterMs: 0
      }
    ]
  };

  const result = await withFakeDocument(
    () => {
      queryCalls += 1;
      return queryCalls === 2 ? [element] : [];
    },
    () =>
      runWorkflow(workflow, {
        selectorMap: map,
        handlers: {
          click({ context: ctx, resolveResult }) {
            ctx.set("handled", resolveResult?.element === element);
          }
        },
        context,
        telemetry: tracker.telemetry,
        logger,
        backoff: {
          initialDelayMs: 0,
          maxDelayMs: 1,
          factor: 1,
          jitterMs: 0
        }
      })
  );

  assert(result.status === "success", "workflow should succeed after retry");
  assert(queryCalls === 2, "resolver should query twice due to retry");
  assert(result.context.preserved === "value", "context must retain prior state");
  assert(result.context.handled === true, "handler should confirm resolved element");
  const warnLog = logs.find((entry) => entry.level === "warn" && entry.message === "Workflow resolver miss");
  assert(warnLog, "miss should be logged during first attempt");
  assert(tracker.missEvents.length >= 1, "telemetry should capture miss");
  const successLog = logs.find((entry) => entry.level === "info" && entry.message === "Workflow resolver success");
  assert(successLog, "success should be logged after retry");
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
