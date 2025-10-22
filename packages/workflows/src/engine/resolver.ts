import { resolveSelector, type ResolveResult, type ResolverOptions } from "../../../core/resolve";
import {
  createResolverTelemetry,
  type ResolverTelemetry
} from "../../../core/resolve-telemetry";
import type { SelectorMap } from "../../../selectors/types";
import {
  buildCancellationError,
  buildResolverMissError,
  StepError
} from "./errors";
import type { WorkflowResolver, WorkflowResolverRequest } from "./runtime";

export interface WorkflowResolverBridgeOptions {
  selectorMap: SelectorMap;
  telemetry?: ResolverTelemetry;
  resolve?: (map: SelectorMap, key: string, options: ResolverOptions) => Promise<ResolveResult> | ResolveResult;
  cache?: Map<string, ResolveResult>;
}

type ResolverCache = Map<string, ResolveResult>;

export class WorkflowResolverBridge implements WorkflowResolver {
  #map: SelectorMap;
  #telemetry: ResolverTelemetry;
  #resolve: Required<WorkflowResolverBridgeOptions>["resolve"];
  #cache: ResolverCache;

  constructor(options: WorkflowResolverBridgeOptions) {
    this.#map = options.selectorMap;
    this.#telemetry = options.telemetry ?? createResolverTelemetry({ source: "workflow-engine" });
    this.#resolve = options.resolve ?? resolveSelector;
    this.#cache = options.cache ?? new Map<string, ResolveResult>();
  }

  async resolve(request: WorkflowResolverRequest): Promise<ResolveResult> {
    ensureActive(request);

    const cacheKey = buildCacheKey(request);
    const cached = this.#cache.get(cacheKey);

    if (cached) {
      request.logger.debug?.("Workflow resolver cache hit", {
        runId: request.runId,
        workflowId: request.workflowId,
        stepId: request.step.id,
        logicalKey: request.step.key,
        attempt: request.attempt
      });

      return cached;
    }

    const result = await resolveSelectorSafe(this.#resolve, this.#map, request, this.#telemetry);

    this.#cache.set(cacheKey, result);

    logAttempts(request, result);

    if (!result.element) {
      request.logger.warn?.("Workflow resolver miss", {
        runId: request.runId,
        workflowId: request.workflowId,
        stepId: request.step.id,
        logicalKey: request.step.key,
        attempt: request.attempt,
        attemptCount: result.attempts.length,
        stabilityScore: result.entry?.stabilityScore
      });
    } else {
      request.logger.info?.("Workflow resolver success", {
        runId: request.runId,
        workflowId: request.workflowId,
        stepId: request.step.id,
        logicalKey: request.step.key,
        attempt: request.attempt,
        strategy: result.resolvedBy?.type,
        stabilityScore: result.entry?.stabilityScore
      });
    }

    return result;
  }

  clear(runId?: string): void {
    if (!runId) {
      this.#cache.clear();
      return;
    }

    for (const key of this.#cache.keys()) {
      if (key.startsWith(runId + ":")) {
        this.#cache.delete(key);
      }
    }
  }
}

export function createWorkflowResolverBridge(options: WorkflowResolverBridgeOptions): WorkflowResolver {
  return new WorkflowResolverBridge(options);
}

function ensureActive(request: WorkflowResolverRequest): void {
  if (!request.signal.aborted) {
    return;
  }

  throw buildCancellationError(request.step, request.attempt);
}

async function resolveSelectorSafe(
  delegate: NonNullable<WorkflowResolverBridgeOptions["resolve"]>,
  map: SelectorMap,
  request: WorkflowResolverRequest,
  telemetry: ResolverTelemetry
): Promise<ResolveResult> {
  try {
    const result = await Promise.resolve(
      delegate(map, request.step.key, {
        logger: request.logger,
        telemetry
      })
    );

    ensureActive(request);

    return result;
  } catch (error) {
    throw wrapResolveError(error, request);
  }
}

function wrapResolveError(error: unknown, request: WorkflowResolverRequest): StepError {
  if (error instanceof StepError) {
    return error;
  }

  if (error instanceof Error && error.name === "AbortError") {
    return buildCancellationError(request.step, request.attempt);
  }

  return buildResolverMissError(request.step, request.step.key, request.attempt, {
    cause: error instanceof Error ? error.message : String(error)
  });
}

function buildCacheKey(request: WorkflowResolverRequest): string {
  const stepId = request.step.id ?? `${request.step.kind}:${request.step.key}`;
  return `${request.runId}:${request.workflowId}:${stepId}:attempt:${request.attempt}`;
}

function logAttempts(request: WorkflowResolverRequest, result: ResolveResult): void {
  if (result.attempts.length === 0) {
    return;
  }

  result.attempts.forEach((attempt, index) => {
    request.logger.debug?.("Workflow resolver attempt", {
      runId: request.runId,
      workflowId: request.workflowId,
      stepId: request.step.id,
      logicalKey: request.step.key,
      attempt: index + 1,
      strategy: attempt.strategy?.type,
      elements: attempt.elements.length,
      success: attempt.success
    });
  });
}
