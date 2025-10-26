import * as coreLogger from "../../../core/debug";
import {
  type WorkflowRuntimeTelemetry,
  type WorkflowRunTelemetryEvent
} from "../engine/runtime";
import {
  SENSITIVE_KEY_PATTERN,
  maskValue
} from "../actions/shared";
import {
  type StepErrorPayload,
  type StepTelemetryEvent
} from "../types";

export type StepEventListener = (events: ReadonlyArray<StepTelemetryEvent>) => void;
export type RunEventPhase = "started" | "completed" | "cancelled";
export type RunEventListener = (event: WorkflowRunTelemetryEvent, phase: RunEventPhase) => void;

export interface WorkflowTelemetryObserver {
  onRun?(event: WorkflowRunTelemetryEvent, phase: RunEventPhase): void;
  onSteps?(events: ReadonlyArray<StepTelemetryEvent>): void;
  onFlush?(runId: string): Promise<void> | void;
}

export interface WorkflowTelemetryAdapterOptions {
  stepListeners?: StepEventListener[];
  runListeners?: RunEventListener[];
  sanitize?: (value: unknown) => unknown;
  batchIntervalMs?: number;
  onFlush?: (runId: string) => Promise<void> | void;
  observers?: WorkflowTelemetryObserver[];
}

const DEFAULT_BATCH_INTERVAL_MS = 16;

export class WorkflowTelemetryAdapter implements WorkflowRuntimeTelemetry {
  #stepBuffer: StepTelemetryEvent[] = [];
  #stepListeners = new Set<StepEventListener>();
  #runListeners = new Set<RunEventListener>();
  #batchInterval: number;
  #sanitize?: (value: unknown) => unknown;
  #rafHandle: number | null = null;
  #timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  #onFlush?: (runId: string) => Promise<void> | void;
  #observers = new Set<WorkflowTelemetryObserver>();

  constructor(options: WorkflowTelemetryAdapterOptions = {}) {
    this.#batchInterval = Math.max(1, options.batchIntervalMs ?? DEFAULT_BATCH_INTERVAL_MS);
    this.#sanitize = options.sanitize;
    this.#onFlush = options.onFlush;

    options.stepListeners?.forEach((listener) => {
      this.onStep(listener);
    });

    options.runListeners?.forEach((listener) => {
      this.onRun(listener);
    });

    options.observers?.forEach((observer) => {
      this.addObserver(observer);
    });
  }

  onStep(listener: StepEventListener): () => void {
    this.#stepListeners.add(listener);
    return () => {
      this.#stepListeners.delete(listener);
    };
  }

  onRun(listener: RunEventListener): () => void {
    this.#runListeners.add(listener);
    return () => {
      this.#runListeners.delete(listener);
    };
  }

  addObserver(observer: WorkflowTelemetryObserver): () => void {
    this.#observers.add(observer);
    return () => {
      this.#observers.delete(observer);
    };
  }

  runStarted(event: WorkflowRunTelemetryEvent): void {
    const sanitized = sanitizeRunEvent(event, this.#sanitize);
    coreLogger.info("Workflow run started", sanitized);
    this.#emitRun(sanitized, "started");
    this.#notifyRun(sanitized, "started");
  }

  runCompleted(event: WorkflowRunTelemetryEvent): void {
    this.#flushSteps();
    const sanitized = sanitizeRunEvent(event, this.#sanitize);
    coreLogger.info("Workflow run completed", sanitized);
    this.#emitRun(sanitized, "completed");
    this.#notifyRun(sanitized, "completed");
  }

  runCancelled(event: WorkflowRunTelemetryEvent): void {
    this.#flushSteps();
    const sanitized = sanitizeRunEvent(event, this.#sanitize);
    coreLogger.warn("Workflow run cancelled", sanitized);
    this.#emitRun(sanitized, "cancelled");
    this.#notifyRun(sanitized, "cancelled");
  }

  stepEvent(event: StepTelemetryEvent): void {
    const sanitized = sanitizeStepEvent(event, this.#sanitize);
    this.#logStepEvent(sanitized);
    this.#stepBuffer.push(sanitized);
    this.#scheduleStepFlush();
  }

  async flush(runId: string): Promise<void> {
    this.#flushSteps();

    if (this.#onFlush) {
      await this.#onFlush(runId);
    }

    await this.#notifyFlush(runId);
  }

  #emitRun(event: WorkflowRunTelemetryEvent, phase: RunEventPhase): void {
    if (this.#runListeners.size === 0) {
      return;
    }

    for (const listener of this.#runListeners) {
      try {
        listener(event, phase);
      } catch (error) {
        coreLogger.debug("Workflow telemetry run listener error", {
          phase,
          error: serializeError(error)
        });
      }
    }
  }

  #notifyRun(event: WorkflowRunTelemetryEvent, phase: RunEventPhase): void {
    if (this.#observers.size === 0) {
      return;
    }

    for (const observer of this.#observers) {
      try {
        observer.onRun?.(event, phase);
      } catch (error) {
        coreLogger.debug("Workflow telemetry observer run error", {
          phase,
          error: serializeError(error)
        });
      }
    }
  }

  #scheduleStepFlush(): void {
    if (this.#rafHandle !== null || this.#timeoutHandle !== null) {
      return;
    }

    if (typeof globalThis.requestAnimationFrame === "function") {
      this.#rafHandle = globalThis.requestAnimationFrame(() => {
        this.#rafHandle = null;
        this.#flushSteps();
      });
      return;
    }

    this.#timeoutHandle = setTimeout(() => {
      this.#timeoutHandle = null;
      this.#flushSteps();
    }, this.#batchInterval);
  }

  #flushSteps(): void {
    if (this.#rafHandle !== null && typeof globalThis.cancelAnimationFrame === "function") {
      globalThis.cancelAnimationFrame(this.#rafHandle);
      this.#rafHandle = null;
    }

    if (this.#timeoutHandle !== null) {
      clearTimeout(this.#timeoutHandle);
      this.#timeoutHandle = null;
    }

    if (this.#stepBuffer.length === 0) {
      return;
    }

    const events = this.#stepBuffer
      .splice(0, this.#stepBuffer.length)
      .sort((a, b) => a.timestamp - b.timestamp);

    coreLogger.debug("Workflow telemetry step batch", {
      count: events.length,
      first: events[0],
      last: events[events.length - 1]
    });

    this.#notifySteps(events);

    if (this.#stepListeners.size === 0) {
      return;
    }

    for (const listener of this.#stepListeners) {
      try {
        listener(events);
      } catch (error) {
        coreLogger.debug("Workflow telemetry step listener error", {
          error: serializeError(error)
        });
      }
    }
  }

  #notifySteps(events: ReadonlyArray<StepTelemetryEvent>): void {
    if (events.length === 0 || this.#observers.size === 0) {
      return;
    }

    for (const observer of this.#observers) {
      try {
        observer.onSteps?.(events);
      } catch (error) {
        coreLogger.debug("Workflow telemetry observer step error", {
          error: serializeError(error)
        });
      }
    }
  }

  async #notifyFlush(runId: string): Promise<void> {
    if (this.#observers.size === 0) {
      return;
    }

    const pending: Promise<void>[] = [];

    for (const observer of this.#observers) {
      if (!observer.onFlush) {
        continue;
      }

      try {
        const result = observer.onFlush(runId);
        if (result instanceof Promise) {
          pending.push(
            result.catch((error) => {
              coreLogger.debug("Workflow telemetry observer flush error", {
                error: serializeError(error)
              });
            })
          );
        }
      } catch (error) {
        coreLogger.debug("Workflow telemetry observer flush error", {
          error: serializeError(error)
        });
      }
    }

    if (pending.length > 0) {
      await Promise.all(pending);
    }
  }

  #logStepEvent(event: StepTelemetryEvent): void {
    switch (event.status) {
      case "attempt":
        coreLogger.info("Workflow step attempt", event);
        return;
      case "success":
        coreLogger.info("Workflow step success", event);
        return;
      case "failure":
        coreLogger.warn("Workflow step failure", event);
        return;
      default:
        return;
    }
  }
}

function sanitizeRunEvent(
  event: WorkflowRunTelemetryEvent,
  sanitize?: (value: unknown) => unknown
): WorkflowRunTelemetryEvent {
  const metadata =
    typeof event.metadata === "undefined"
      ? undefined
      : (sanitizeData(event.metadata, sanitize) as Record<string, unknown>);

  return {
    ...event,
    metadata,
    error: sanitizeError(event.error, sanitize)
  };
}

function sanitizeStepEvent(
  event: StepTelemetryEvent,
  sanitize?: (value: unknown) => unknown
): StepTelemetryEvent {
  const data =
    typeof event.data === "undefined"
      ? undefined
      : (sanitizeData(event.data, sanitize) as Record<string, unknown> | undefined);

  return {
    ...event,
    data,
    error: sanitizeError(event.error, sanitize)
  };
}

function sanitizeError(
  error: StepErrorPayload | undefined,
  sanitize?: (value: unknown) => unknown
): StepErrorPayload | undefined {
  if (!error) {
    return undefined;
  }

  return {
    ...error,
    data: sanitizeData(error.data, sanitize) as Record<string, unknown> | undefined
  };
}

function sanitizeData(value: unknown, sanitize?: (value: unknown) => unknown): unknown {
  if (typeof sanitize === "function") {
    return sanitize(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeData(entry, sanitize));
  }

  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};

    Object.entries(input).forEach(([key, entry]) => {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        output[key] = maskValue(entry);
        return;
      }

      output[key] = sanitizeData(entry, sanitize);
    });

    return output;
  }

  return value;
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  if (error && typeof error === "object") {
    return { ...(error as Record<string, unknown>) };
  }

  return { message: String(error) };
}
