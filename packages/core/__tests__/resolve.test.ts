import { resolveSelector } from "../resolve";
import type {
  ResolverTelemetry,
  ResolverAttemptEvent,
  ResolverMissEvent,
  ResolverSuccessEvent
} from "../resolve-telemetry";
import type { SelectorMap } from "../../selectors/types";

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
  } satisfies typeof import("../debug");
}

function withFakeDocument<T>(queryResults: (selector: string) => Element[], run: () => T): T {
  const originalDocument = globalThis.document;

  const fakeDocument = {
    querySelectorAll(selector: string): Element[] {
      return queryResults(selector);
    }
  } as unknown as Document;

  globalThis.document = fakeDocument;

  try {
    return run();
  } finally {
    globalThis.document = originalDocument;
  }
}

function createTelemetryTracker() {
  const attempts: ResolverAttemptEvent[] = [];
  const successes: ResolverSuccessEvent[] = [];
  const misses: ResolverMissEvent[] = [];

  const telemetry: ResolverTelemetry = {
    logAttempt(event) {
      attempts.push(event);
    },
    logSuccess(event) {
      successes.push(event);
    },
    logMiss(event) {
      misses.push(event);
    }
  };

  return { telemetry, attempts, successes, misses };
}

function createSelectorMap(): SelectorMap {
  return {
    primaryButton: {
      tries: [
        {
          type: "css",
          selector: ".primary"
        }
      ]
    },
    scopedChild: {
      scopeKey: "primaryButton",
      tries: [
        {
          type: "css",
          selector: ".child"
        }
      ]
    }
  } satisfies SelectorMap;
}

test("resolveSelector returns first matching element and emits success telemetry", () => {
  const map = createSelectorMap();
  const tracker = createTelemetryTracker();
  const logs: LogEntry[] = [];
  const logger = createLogger(logs);

  const element = { id: "primary" } as unknown as Element;

  const selectors: string[] = [];

  const result = withFakeDocument((selector) => {
    selectors.push(selector);
    return selector === ".primary" ? [element] : [];
  }, () =>
    resolveSelector(map, "primaryButton", {
      telemetry: tracker.telemetry,
      logger
    })
  );

  assert(result.element === element, "resolver should return matching element");
  assert(result.resolvedBy?.type === "css", "resolved strategy should be css");
  assert(selectors.includes(".primary"), "resolver should query expected selector");
  const successLog = logs.find((entry) => entry.level === "info" && entry.message === "Resolver success");
  assert(successLog, "success should be logged");
  assert(tracker.successes.length === 1, "telemetry should record success event");
  assert(tracker.misses.length === 0, "no miss should be recorded on success");
});

test("resolveSelector emits miss telemetry and logs warning when strategies fail", () => {
  const map = createSelectorMap();
  const tracker = createTelemetryTracker();
  const logs: LogEntry[] = [];
  const logger = createLogger(logs);

  const result = withFakeDocument(() => [], () =>
    resolveSelector(map, "primaryButton", {
      telemetry: tracker.telemetry,
      logger
    })
  );

  assert(result.element === null, "resolver should return null for misses");
  assert(result.attempts.length === 1, "expected single attempt recorded");
  const missLog = logs.find((entry) => entry.level === "warn" && entry.message === "Resolver miss");
  assert(missLog, "miss should be logged as warning");
  assert(tracker.misses.length === 1, "telemetry should record miss event");
});

test("resolveSelector resolves scoped entries before child strategies", () => {
  const map = createSelectorMap();
  const tracker = createTelemetryTracker();
  const logs: LogEntry[] = [];
  const logger = createLogger(logs);

  const childElement = { id: "child" } as unknown as Element;
  const scopeElement = {
    id: "primary",
    querySelectorAll(selector: string): Element[] {
      return selector === ".child" ? [childElement] : [];
    }
  } as unknown as Element;

  const query = (selector: string): Element[] => {
    if (selector === ".primary") {
      return [scopeElement];
    }
    return [];
  };

  const result = withFakeDocument(query, () =>
    resolveSelector(map, "scopedChild", {
      telemetry: tracker.telemetry,
      logger
    })
  );

  assert(result.element === childElement, "resolver should resolve scoped child element");
  assert(result.scope?.key === "primaryButton", "scope key should be reported");
  const successLog = logs.find((entry) => entry.level === "info" && entry.message === "Resolver success");
  assert(successLog, "success should be logged");
  const childSuccess = tracker.successes.some((event) => event.key === "scopedChild");
  assert(childSuccess, "telemetry should capture success for scoped resolution");
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
