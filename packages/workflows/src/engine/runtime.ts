import * as coreLogger from "../../../core/debug";
import type { ResolveResult } from "../../../core/resolve";
import {
  mergeRuntimeTiming,
  type RuntimeTimingConfig,
  type RuntimeTimingOverrides
} from "../config";
import {
  InMemoryWorkflowContext,
  type WorkflowContext,
  type WorkflowContextSnapshot,
  type WorkflowDefinition,
  type WorkflowHandlers,
  type WorkflowRunOutcome,
  type WorkflowStep,
  type StepErrorPayload,
  type StepTelemetryEvent,
  type WorkflowRuntimeLogger
} from "../types";
import { StepError } from "./errors";

export type WorkflowRunStatus = "pending" | "running" | "success" | "failed" | "cancelled";

export interface WorkflowRunTelemetryEvent {
  runId: string;
  workflowId: string;
  status: WorkflowRunStatus;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  completedSteps?: number;
  error?: StepErrorPayload;
  metadata?: Record<string, unknown>;
}

export interface WorkflowRuntimeTelemetry {
  runStarted?(event: WorkflowRunTelemetryEvent): void;
  runCompleted?(event: WorkflowRunTelemetryEvent): void;
  runCancelled?(event: WorkflowRunTelemetryEvent): void;
  stepEvent?(event: StepTelemetryEvent): void;
  flush?(runId: string): Promise<void> | void;
}

export interface WorkflowResolverRequest {
  runId: string;
  workflowId: string;
  step: WorkflowStep & { key: string };
  attempt: number;
  signal: AbortSignal;
  context: WorkflowContext;
  logger: WorkflowRuntimeLogger;
}

export interface WorkflowResolver {
  resolve(request: WorkflowResolverRequest): Promise<ResolveResult>;
}

export interface WorkflowRunMetadata {
  id: string;
  workflowId: string;
  status: WorkflowRunStatus;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  completedSteps: number;
  cancelRequested: boolean;
  timing: RuntimeTimingConfig;
  contextSnapshots: {
    initial: WorkflowContextSnapshot;
    final?: WorkflowContextSnapshot;
  };
  error?: StepErrorPayload;
  metadata: Record<string, unknown>;
}

export interface WorkflowSchedulerEnvironment {
  runId: string;
  definition: WorkflowDefinition;
  handlers: WorkflowHandlers;
  context: WorkflowContext;
  resolver: WorkflowResolver;
  telemetry: WorkflowRuntimeTelemetry;
  logger: WorkflowRuntimeLogger;
  timing: RuntimeTimingConfig;
  signal: AbortSignal;
  metadata: WorkflowRunMetadata;
}

export interface WorkflowSchedulerResult {
  status: Exclude<WorkflowRunStatus, "pending" | "running">;
  completedSteps: number;
  error?: StepError | unknown;
}

export interface WorkflowScheduler {
  run(env: WorkflowSchedulerEnvironment): Promise<WorkflowSchedulerResult>;
}

export interface WorkflowRuntimeOptions {
  handlers: WorkflowHandlers;
  scheduler: WorkflowScheduler;
  resolver: WorkflowResolver;
  timingOverrides?: RuntimeTimingOverrides;
  context?: WorkflowContext;
  createContext?: (initial?: WorkflowContextSnapshot) => WorkflowContext;
  initialContext?: WorkflowContextSnapshot;
  telemetry?: WorkflowRuntimeTelemetry;
  logger?: WorkflowRuntimeLogger;
  metadata?: Record<string, unknown>;
  runId?: string;
  runIdFactory?: () => string;
}

interface ActiveRunState {
  controller: AbortController;
  logger: WorkflowRuntimeLogger;
  telemetry: WorkflowRuntimeTelemetry;
  record: WorkflowRunMetadata;
}

const runRecords = new Map<string, WorkflowRunMetadata>();
const activeRuns = new Map<string, ActiveRunState>();

const defaultLogger: WorkflowRuntimeLogger = {
  debug: coreLogger.debug,
  info: coreLogger.info,
  warn: coreLogger.warn,
  error: coreLogger.error
};

export async function runWorkflow(
  definition: WorkflowDefinition,
  options: WorkflowRuntimeOptions
): Promise<WorkflowRunOutcome> {
  validateDefinition(definition);
  validateRuntimeOptions(options);

  const logger = options.logger ?? defaultLogger;
  const telemetry = options.telemetry ?? {};
  const runId = resolveRunId(options);
  const timing = mergeRuntimeTiming(definition.defaults, options.timingOverrides);
  const context = resolveContext(options);
  const initialSnapshot = context.snapshot();
  const startedAt = Date.now();

  const record: WorkflowRunMetadata = {
    id: runId,
    workflowId: definition.id,
    status: "running",
    startedAt,
    finishedAt: undefined,
    durationMs: undefined,
    completedSteps: 0,
    cancelRequested: false,
    timing,
    contextSnapshots: {
      initial: initialSnapshot,
      final: undefined
    },
    error: undefined,
    metadata: buildRunMetadata(definition, options.metadata)
  };

  runRecords.set(runId, record);

  const controller = new AbortController();
  activeRuns.set(runId, {
    controller,
    logger,
    telemetry,
    record
  });

  telemetry.runStarted?.(toTelemetryEvent(record));

  let schedulerResult: WorkflowSchedulerResult | undefined;
  let failure: unknown;

  try {
    schedulerResult = await options.scheduler.run({
      runId,
      definition,
      handlers: options.handlers,
      context,
      resolver: options.resolver,
      telemetry,
      logger,
      timing,
      signal: controller.signal,
      metadata: record
    });
  } catch (error) {
    failure = error;
  }

  const finishedAt = Date.now();
  const finalSnapshot = context.snapshot();

  const { status, completedSteps, errorPayload } = resolveRunCompletion(
    schedulerResult,
    failure,
    controller.signal,
    logger,
    definition,
    record
  );

  finalizeRunRecord(record, status, finishedAt, completedSteps, finalSnapshot, errorPayload);

  if (status === "success") {
    logger.info?.("Workflow run completed", {
      runId,
      workflowId: definition.id,
      steps: completedSteps,
      durationMs: record.durationMs
    });
  } else if (status === "failed") {
    logger.error?.("Workflow run failed", {
      runId,
      workflowId: definition.id,
      error: serializeError(failure)
    });
  } else if (status === "cancelled") {
    logger.warn?.("Workflow run cancelled", {
      runId,
      workflowId: definition.id,
      steps: completedSteps
    });
  }

  telemetry.runCompleted?.(toTelemetryEvent(record));

  activeRuns.delete(runId);

  try {
    await telemetry.flush?.(runId);
  } catch (telemetryError) {
    logger.warn?.("Workflow telemetry flush error", {
      runId,
      error: serializeError(telemetryError)
    });
  }

  return {
    status,
    startedAt,
    finishedAt,
    completedSteps,
    error: errorPayload,
    contextSnapshot: finalSnapshot
  };
}

export function cancelRun(runId: string): boolean {
  const active = activeRuns.get(runId);

  if (!active) {
    return false;
  }

  if (active.controller.signal.aborted) {
    return false;
  }

  active.record.cancelRequested = true;

  active.logger.info?.("Workflow run cancellation requested", {
    runId,
    workflowId: active.record.workflowId
  });

  const cancelledAt = Date.now();

  active.telemetry.runCancelled?.(
    toTelemetryEvent({
      ...active.record,
      status: "cancelled",
      finishedAt: cancelledAt,
      durationMs: cancelledAt - active.record.startedAt
    })
  );

  active.controller.abort();

  return true;
}

export function getRunMetadata(runId: string): WorkflowRunMetadata | undefined {
  const record = runRecords.get(runId);

  if (!record) {
    return undefined;
  }

  return cloneRunRecord(record);
}

function validateDefinition(definition: WorkflowDefinition): void {
  if (!definition || typeof definition !== "object") {
    throw new Error("Workflow definition is required");
  }

  if (!definition.id || typeof definition.id !== "string") {
    throw new Error("Workflow definition must include an id");
  }
}

function validateRuntimeOptions(options: WorkflowRuntimeOptions): void {
  if (!options.handlers || Object.keys(options.handlers).length === 0) {
    throw new Error("Workflow runtime requires at least one handler");
  }

  if (!options.scheduler) {
    throw new Error("Workflow runtime requires a scheduler");
  }

  if (!options.resolver) {
    throw new Error("Workflow runtime requires a resolver");
  }
}

function resolveRunId(options: WorkflowRuntimeOptions): string {
  if (options.runId && options.runId.length > 0) {
    return options.runId;
  }

  if (options.runIdFactory) {
    const generated = options.runIdFactory();

    if (generated && generated.length > 0) {
      return generated;
    }
  }

  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function resolveContext(options: WorkflowRuntimeOptions): WorkflowContext {
  if (options.context) {
    if (options.initialContext) {
      options.context.merge(options.initialContext);
    }

    return options.context;
  }

  const factory = options.createContext ?? ((initial?: WorkflowContextSnapshot) => new InMemoryWorkflowContext(initial));

  return factory(options.initialContext);
}

function buildRunMetadata(
  definition: WorkflowDefinition,
  overrides?: Record<string, unknown>
): Record<string, unknown> {
  return {
    workflowLabel: definition.label,
    workflowVersion: definition.version,
    workflowTags: definition.tags,
    ...overrides
  };
}

function resolveRunCompletion(
  result: WorkflowSchedulerResult | undefined,
  failure: unknown,
  signal: AbortSignal,
  logger: WorkflowRuntimeLogger,
  definition: WorkflowDefinition,
  record: WorkflowRunMetadata
): {
  status: Exclude<WorkflowRunStatus, "pending" | "running">;
  completedSteps: number;
  errorPayload?: StepErrorPayload;
} {
  if (result) {
    return {
      status: result.status,
      completedSteps: Math.max(0, result.completedSteps ?? 0),
      errorPayload: toErrorPayload(result.error)
    };
  }

  const cancelled = signal.aborted || isAbortError(failure);

  if (cancelled) {
    return {
      status: "cancelled",
      completedSteps: Math.max(0, record.completedSteps),
      errorPayload: undefined
    };
  }

  logger.error?.("Workflow scheduler threw", {
    workflowId: definition.id,
    error: serializeError(failure)
  });

  return {
    status: "failed",
    completedSteps: Math.max(0, record.completedSteps),
    errorPayload: toErrorPayload(failure)
  };
}

function finalizeRunRecord(
  record: WorkflowRunMetadata,
  status: Exclude<WorkflowRunStatus, "pending" | "running">,
  finishedAt: number,
  completedSteps: number,
  finalSnapshot: WorkflowContextSnapshot,
  errorPayload?: StepErrorPayload
): void {
  record.status = status;
  record.finishedAt = finishedAt;
  record.durationMs = finishedAt - record.startedAt;
  record.completedSteps = completedSteps;
  record.contextSnapshots.final = finalSnapshot;
  record.error = errorPayload;

  if (status === "cancelled") {
    record.cancelRequested = true;
  }
}

function toTelemetryEvent(record: WorkflowRunMetadata): WorkflowRunTelemetryEvent {
  return {
    runId: record.id,
    workflowId: record.workflowId,
    status: record.status,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    durationMs: record.durationMs,
    completedSteps: record.completedSteps,
    error: record.error,
    metadata: { ...record.metadata }
  };
}

function cloneRunRecord(record: WorkflowRunMetadata): WorkflowRunMetadata {
  return {
    ...record,
    timing: { ...record.timing },
    metadata: { ...record.metadata },
    contextSnapshots: {
      initial: { ...record.contextSnapshots.initial },
      final: record.contextSnapshots.final ? { ...record.contextSnapshots.final } : undefined
    }
  };
}

function toErrorPayload(error: unknown): StepErrorPayload | undefined {
  if (!error) {
    return undefined;
  }

  if (error instanceof StepError) {
    return error.toPayload();
  }

  const message = error instanceof Error ? error.message : String(error);

  return {
    reason: "unknown",
    message
  };
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === "AbortError" || error.message === "The operation was aborted";
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  if (typeof error === "object" && error !== null) {
    return { ...error } as Record<string, unknown>;
  }

  return {
    message: String(error)
  };
}
