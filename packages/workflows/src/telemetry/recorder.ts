import type { StepTelemetryEvent, StepErrorPayload } from "../types";
import type { WorkflowRunTelemetryEvent } from "../engine/runtime";
import type { RunEventPhase, WorkflowTelemetryObserver } from "./runtime";

export type WorkflowTimelineEvent =
  | {
      kind: "run";
      runId: string;
      workflowId: string;
      phase: RunEventPhase;
      status: WorkflowRunTelemetryEvent["status"];
      timestamp: number;
      event: WorkflowRunTelemetryEvent;
    }
  | {
      kind: "step";
      runId: string;
      workflowId: string;
      status: StepTelemetryEvent["status"];
      stepIndex: number;
      attempt: number;
      logicalKey?: string;
      timestamp: number;
      durationMs?: number;
      event: StepTelemetryEvent;
    };

export type WorkflowTimeline = ReadonlyArray<WorkflowTimelineEvent>;

export class WorkflowEventRecorder implements WorkflowTelemetryObserver {
  #timeline = new Map<string, WorkflowTimelineEvent[]>();
  #runs = new Map<string, WorkflowRunTelemetryEvent>();

  onRun(event: WorkflowRunTelemetryEvent, phase: RunEventPhase): void {
    const cloned = cloneRunEvent(event);
    const timestamp = phase === "started"
      ? cloned.startedAt
      : cloned.finishedAt ?? cloned.startedAt;

    this.#append(cloned.runId, {
      kind: "run",
      runId: cloned.runId,
      workflowId: cloned.workflowId,
      phase,
      status: cloned.status,
      timestamp,
      event: cloned
    });

    this.#runs.set(cloned.runId, cloned);
  }

  onSteps(events: ReadonlyArray<StepTelemetryEvent>): void {
    events.forEach((event) => {
      const cloned = cloneStepEvent(event);
      this.#append(cloned.runId, {
        kind: "step",
        runId: cloned.runId,
        workflowId: cloned.workflowId,
        status: cloned.status,
        stepIndex: cloned.stepIndex,
        attempt: cloned.attempt,
        logicalKey: cloned.logicalKey,
        timestamp: cloned.timestamp,
        durationMs: cloned.durationMs,
        event: cloned
      });
    });
  }

  onFlush(_runId: string): void {
    // Recorder currently does not require flush-specific behaviour.
  }

  timeline(runId: string): WorkflowTimeline {
    const events = this.#timeline.get(runId) ?? [];
    return events.map(cloneTimelineEvent);
  }

  getRun(runId: string): WorkflowRunTelemetryEvent | undefined {
    const record = this.#runs.get(runId);
    return record ? cloneRunEvent(record) : undefined;
  }

  listRuns(): WorkflowRunTelemetryEvent[] {
    return Array.from(this.#runs.values()).map((event) => cloneRunEvent(event));
  }

  clear(runId?: string): void {
    if (typeof runId === "string") {
      this.#timeline.delete(runId);
      this.#runs.delete(runId);
      return;
    }

    this.#timeline.clear();
    this.#runs.clear();
  }

  #append(runId: string, entry: WorkflowTimelineEvent): void {
    const existing = this.#timeline.get(runId);

    if (existing) {
      existing.push(entry);
      return;
    }

    this.#timeline.set(runId, [entry]);
  }
}

function cloneTimelineEvent(event: WorkflowTimelineEvent): WorkflowTimelineEvent {
  if (event.kind === "run") {
    return {
      ...event,
      event: cloneRunEvent(event.event)
    } satisfies WorkflowTimelineEvent;
  }

  return {
    ...event,
    event: cloneStepEvent(event.event)
  } satisfies WorkflowTimelineEvent;
}

function cloneRunEvent(event: WorkflowRunTelemetryEvent): WorkflowRunTelemetryEvent {
  return {
    ...event,
    error: cloneStepError(event.error),
    metadata: event.metadata ? cloneRecord(event.metadata) : undefined
  } satisfies WorkflowRunTelemetryEvent;
}

function cloneStepEvent(event: StepTelemetryEvent): StepTelemetryEvent {
  return {
    ...event,
    error: cloneStepError(event.error)
  } satisfies StepTelemetryEvent;
}

function cloneStepError(error: StepErrorPayload | undefined): StepErrorPayload | undefined {
  if (!error) {
    return undefined;
  }

  return {
    ...error,
    data: error.data ? cloneRecord(error.data) : undefined
  } satisfies StepErrorPayload;
}

function cloneRecord<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneRecord(entry)) as T;
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};

    Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
      output[key] = cloneRecord(entry);
    });

    return output as T;
  }

  return value;
}
