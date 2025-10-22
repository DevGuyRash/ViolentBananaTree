import * as coreLogger from "../../../core/debug";
import {
  type WorkflowRuntimeTelemetry,
  type WorkflowRunTelemetryEvent
} from "../engine/runtime";
import {
  type StepErrorPayload,
  type StepTelemetryEvent
} from "../types";

export type StepEventListener = (events: ReadonlyArray<StepTelemetryEvent>) => void;
export type RunEventPhase = "started" | "completed" | "cancelled";
export type RunEventListener = (event: WorkflowRunTelemetryEvent, phase: RunEventPhase) => void;

export interface WorkflowTelemetryAdapterOptions {
  stepListeners?: StepEventListener[];
  runListeners?: RunEventListener[];
  sanitize?: (value: unknown) => unknown;
  batchIntervalMs?: number;
  onFlush?: (runId: string) => Promise<void> | void;
}

const DEFAULT_BATCH_INTERVAL_MS = 16;
const SENSITIVE_KEY_PATTERN = /(password|secret|token|auth|cookie|session|key)/i;

export class WorkflowTelemetryAdapter implements WorkflowRuntimeTelemetry {
  #stepBuffer: StepTelemetryEvent[] = [];
  #stepListeners = new Set<StepEventListener>();
  #runListeners = new Set<RunEventListener>();
  #batchInterval: number;
  #sanitize?: (value: unknown) => unknown;
  #rafHandle: number | null = null;
  #timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  #onFlush?: (runId: string) => Promise<void> | void;

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

  runStarted(event: WorkflowRunTelemetryEvent): void {
    const sanitized = sanitizeRunEvent(event, this.#sanitize);
    coreLogger.info("Workflow run started", sanitized);
    this.#emitRun(sanitized, "started");
  }

  runCompleted(event: WorkflowRunTelemetryEvent): void {
    this.#flushSteps();
    const sanitized = sanitizeRunEvent(event, this.#sanitize);
    coreLogger.info("Workflow run completed", sanitized);
    this.#emitRun(sanitized, "completed");
  }

  runCancelled(event: WorkflowRunTelemetryEvent): void {
    this.#flushSteps();
    const sanitized = sanitizeRunEvent(event, this.#sanitize);
    coreLogger.warn("Workflow run cancelled", sanitized);
    this.#emitRun(sanitized, "cancelled");
  }

  stepEvent(event: StepTelemetryEvent): void {
    const sanitized = sanitizeStepEvent(event, this.#sanitize);
    this.#stepBuffer.push(sanitized);
    this.#scheduleStepFlush();
  }

  async flush(runId: string): Promise<void> {
    this.#flushSteps();

    if (this.#onFlush) {
      await this.#onFlush(runId);
    }
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
}

function sanitizeRunEvent(
  event: WorkflowRunTelemetryEvent,
  sanitize?: (value: unknown) => unknown
): WorkflowRunTelemetryEvent {
  return {
    ...event,
    metadata: sanitizeData(event.metadata ?? {}, sanitize),
    error: sanitizeError(event.error, sanitize)
  };
}

function sanitizeStepEvent(
  event: StepTelemetryEvent,
  sanitize?: (value: unknown) => unknown
): StepTelemetryEvent {
  return {
    ...event,
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
    data: sanitizeData(error.data, sanitize)
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

function maskValue(value: unknown): string {
  if (typeof value === "string" && value.length <= 4) {
    return "****";
  }

  if (typeof value === "number") {
    return "****";
  }

  if (value === null || typeof value === "undefined") {
    return "****";
  }

  return "********";
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
