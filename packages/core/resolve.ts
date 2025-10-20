import type {
  SelectorEntry,
  SelectorMap,
  SelectorTry
} from "../selectors/types";
import { executeStrategy, type QueryRoot } from "./utils/dom";
import * as debug from "./debug";
import type { ResolverTelemetry } from "./resolve-telemetry";
import {
  buildAttemptEvent,
  buildMissEvent,
  buildSuccessEvent,
  summarizeAttempt,
  type ResolverAttemptSummary
} from "./resolve-telemetry";

export type ResolveAttempt = {
  strategy: SelectorTry;
  success: boolean;
  elements: Element[];
};

export type ResolverScope = {
  key?: string;
  root: QueryRoot;
};

export type ResolveResult = {
  key: string;
  element: Element | null;
  attempts: ResolveAttempt[];
  resolvedBy?: SelectorTry;
  scope?: ResolverScope;
  entry?: SelectorEntry;
};

export type ResolverOptions = {
  scopeRoot?: QueryRoot | null;
  logger?: typeof debug;
  telemetry?: ResolverTelemetry | null;
};

type ResolverContext = {
  visitedKeys: Set<string>;
};

function safeGetEntry(map: SelectorMap, key: string): SelectorEntry | null {
  return key in map ? map[key] : null;
}

function resolveScope(
  map: SelectorMap,
  entry: SelectorEntry,
  options: ResolverOptions,
  context: ResolverContext,
  key: string
): ResolverScope | undefined {
  const { scopeKey } = entry;

  if (!scopeKey) {
    if (options.scopeRoot) {
      return { root: options.scopeRoot };
    }
    return undefined;
  }

  if (context.visitedKeys.has(scopeKey)) {
    options.logger?.warn?.("Resolver detected scope cycle", { key, scopeKey });
    return undefined;
  }

  const scopeEntry = safeGetEntry(map, scopeKey);
  if (!scopeEntry) {
    options.logger?.warn?.("Resolver scope missing", { key, scopeKey });
    return undefined;
  }

  const scopeResult = resolveSelectorInternal(map, scopeKey, options, {
    visitedKeys: new Set(context.visitedKeys)
  });

  if (!scopeResult.element) {
    options.logger?.warn?.("Resolver scope unresolved", { key, scopeKey });
    return undefined;
  }

  return { key: scopeKey, root: scopeResult.element };
}

function resolveAgainstStrategies(
  key: string,
  entry: SelectorEntry | undefined,
  scopeKey: string | undefined,
  strategies: SelectorTry[],
  root: QueryRoot | undefined,
  logger: typeof debug | undefined,
  telemetry: ResolverTelemetry | null | undefined
): {
  element: Element | null;
  attempts: ResolveAttempt[];
  resolvedBy?: SelectorTry;
  summaries: ResolverAttemptSummary[];
} {
  const attempts: ResolveAttempt[] = [];
  const summaries: ResolverAttemptSummary[] = [];

  strategies.forEach((strategy, index) => {
    const elements = executeStrategy(strategy, root ?? undefined);
    const success = elements.length > 0;
    attempts.push({ strategy, success, elements });

    const summary = summarizeAttempt(strategy, index, elements.length);
    summaries.push(summary);

    telemetry?.logAttempt(
      buildAttemptEvent(
        key,
        scopeKey,
        index + 1,
        summary,
        entry,
        strategy
      )
    );

    logger?.debug?.("Resolver attempt", {
      key,
      strategyType: strategy.type,
      success,
      count: elements.length
    });

    if (success && elements[0]) {
      telemetry?.logSuccess(
        buildSuccessEvent(
          key,
          scopeKey,
          index + 1,
          summary,
          entry,
          strategy
        )
      );

      const element = elements[0];
      return { element, attempts, resolvedBy: strategy, summaries };
    }
  });

  return { element: null, attempts, summaries };
}

function resolveSelectorInternal(
  map: SelectorMap,
  key: string,
  options: ResolverOptions,
  context: ResolverContext
): ResolveResult {
  if (context.visitedKeys.has(key)) {
    options.logger?.warn?.("Resolver detected recursion", { key });
    return {
      key,
      element: null,
      attempts: []
    };
  }

  context.visitedKeys.add(key);

  const entry = safeGetEntry(map, key);

  if (!entry) {
    options.logger?.warn?.("Resolver missing selector key", { key });
    return {
      key,
      element: null,
      attempts: []
    };
  }

  const scope = resolveScope(map, entry, options, context, key);

  const root = scope?.root ?? options.scopeRoot ?? undefined;
  const { element, attempts, resolvedBy, summaries } = resolveAgainstStrategies(
    key,
    entry,
    scope?.key,
    entry.tries,
    root,
    options.logger,
    options.telemetry
  );

  if (!element) {
    options.logger?.warn?.("Resolver miss", {
      key,
      strategiesTried: entry.tries.length,
      scopeKey: scope?.key,
      scopeResolved: Boolean(scope?.root)
    });

    options.telemetry?.logMiss(
      buildMissEvent(key, scope?.key, summaries, entry)
    );
  } else {
    options.logger?.info?.("Resolver success", {
      key,
      strategy: resolvedBy?.type,
      scopeKey: scope?.key
    });
  }

  return {
    key,
    element,
    attempts,
    resolvedBy,
    scope,
    entry
  };
}

export function resolveSelector(
  map: SelectorMap,
  key: string,
  options: ResolverOptions = {}
): ResolveResult {
  const context: ResolverContext = { visitedKeys: new Set() };
  return resolveSelectorInternal(map, key, options, context);
}

