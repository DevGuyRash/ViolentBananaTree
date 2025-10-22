import { pushHudNotification, type HudLevel, type HudNotification } from "../../menu/hud";
import { maskValue, SENSITIVE_KEY_PATTERN } from "./actions/shared";
import type { WorkflowRunTelemetryEvent } from "./engine/runtime";
import {
  WorkflowTelemetryAdapter,
  type WorkflowTelemetryAdapterOptions,
  type WorkflowTelemetryObserver,
  type RunEventPhase
} from "./telemetry/runtime";
import {
  WorkflowEventRecorder,
  type WorkflowTimeline
} from "./telemetry/recorder";
import type { StepTelemetryEvent } from "./types";

export interface WorkflowHudTelemetryOptions {
  enabled?: boolean;
  notify?: (notification: HudNotification) => void;
  includeAttempts?: boolean;
}

export interface WorkflowTelemetrySetupOptions {
  adapter?: WorkflowTelemetryAdapter;
  adapterOptions?: WorkflowTelemetryAdapterOptions;
  observers?: WorkflowTelemetryObserver[];
  recorder?: boolean | WorkflowEventRecorder;
  hud?: boolean | WorkflowHudTelemetryOptions;
}

export interface WorkflowTelemetryBridge {
  adapter: WorkflowTelemetryAdapter;
  recorder?: WorkflowEventRecorder;
  hudObserver?: WorkflowTelemetryObserver;
  getTimeline(runId: string): WorkflowTimeline;
  listRuns(): WorkflowRunTelemetryEvent[];
  addObserver(observer: WorkflowTelemetryObserver): () => void;
  dispose(): void;
}

export function createWorkflowTelemetry(options: WorkflowTelemetrySetupOptions = {}): WorkflowTelemetryBridge {
  const recorder = resolveRecorder(options.recorder);
  const hudObserver = resolveHudObserver(options.hud);
  const extraObservers = filterObservers([recorder, hudObserver, ...(options.observers ?? [])]);

  let detachObservers: Array<() => void> = [];
  let adapter: WorkflowTelemetryAdapter;

  if (options.adapter) {
    adapter = options.adapter;
    detachObservers = extraObservers.map((observer) => adapter.addObserver(observer));
  } else {
    const baseObservers = new Set<WorkflowTelemetryObserver>(options.adapterOptions?.observers ?? []);
    extraObservers.forEach((observer) => baseObservers.add(observer));

    const adapterOptions: WorkflowTelemetryAdapterOptions = {
      sanitize: options.adapterOptions?.sanitize ?? sanitizeTelemetryValue,
      ...options.adapterOptions,
      observers: Array.from(baseObservers)
    } satisfies WorkflowTelemetryAdapterOptions;

    adapter = new WorkflowTelemetryAdapter(adapterOptions);
  }

  return {
    adapter,
    recorder,
    hudObserver,
    getTimeline(runId) {
      return recorder ? recorder.timeline(runId) : [];
    },
    listRuns() {
      return recorder ? recorder.listRuns() : [];
    },
    addObserver(observer) {
      return adapter.addObserver(observer);
    },
    dispose() {
      detachObservers.forEach((disposeObserver) => {
        try {
          disposeObserver();
        } catch {
          // ignore observer disposal errors
        }
      });
      detachObservers = [];
    }
  } satisfies WorkflowTelemetryBridge;
}

function resolveRecorder(entry: WorkflowTelemetrySetupOptions["recorder"]): WorkflowEventRecorder | undefined {
  if (entry === false) {
    return undefined;
  }

  if (entry instanceof WorkflowEventRecorder) {
    return entry;
  }

  return new WorkflowEventRecorder();
}

function resolveHudObserver(entry: WorkflowTelemetrySetupOptions["hud"]): WorkflowTelemetryObserver | undefined {
  if (entry === false) {
    return undefined;
  }

  const options: WorkflowHudTelemetryOptions = typeof entry === "object" ? entry : {};
  const enabled = options.enabled ?? true;

  if (!enabled) {
    return undefined;
  }

  return createHudTelemetryObserver(options);
}

function filterObservers(observers: Array<WorkflowTelemetryObserver | undefined>): WorkflowTelemetryObserver[] {
  return observers.filter((observer): observer is WorkflowTelemetryObserver => Boolean(observer));
}

export function createHudTelemetryObserver(options: WorkflowHudTelemetryOptions = {}): WorkflowTelemetryObserver {
  const notify = options.notify ?? pushHudNotification;
  const includeAttempts = options.includeAttempts ?? true;

  return {
    onRun(event, phase) {
      safeNotify(notify, buildRunNotification(event, phase));
    },
    onSteps(events) {
      events.forEach((event) => {
        if (event.status === "attempt" && !includeAttempts) {
          return;
        }
        safeNotify(notify, buildStepNotification(event));
      });
    }
  } satisfies WorkflowTelemetryObserver;
}

function buildRunNotification(event: WorkflowRunTelemetryEvent, phase: RunEventPhase): HudNotification {
  return {
    id: `workflow-run-${event.runId}-${phase}`,
    title: runTitle(event, phase),
    description: runDescription(event),
    level: resolveRunLevel(event),
    metadata: {
      ...event,
      phase
    }
  } satisfies HudNotification;
}

function buildStepNotification(event: StepTelemetryEvent): HudNotification {
  return {
    id: `workflow-step-${event.runId}-${event.stepIndex}-${event.status}-${event.attempt}-${event.timestamp}`,
    title: `[DGX] Step ${event.status}`,
    description: stepDescription(event),
    level: event.status === "failure" ? "error" : "info",
    metadata: {
      ...event
    }
  } satisfies HudNotification;
}

function resolveRunLevel(event: WorkflowRunTelemetryEvent): HudLevel {
  if (event.status === "failed") {
    return "error";
  }

  if (event.status === "cancelled") {
    return "warn";
  }

  return "info";
}

function runTitle(event: WorkflowRunTelemetryEvent, phase: RunEventPhase): string {
  if (phase === "started") {
    return `[DGX] Workflow ${event.workflowId} started`;
  }

  if (event.status === "success") {
    return `[DGX] Workflow ${event.workflowId} completed`;
  }

  if (event.status === "failed") {
    return `[DGX] Workflow ${event.workflowId} failed`;
  }

  if (event.status === "cancelled") {
    return `[DGX] Workflow ${event.workflowId} cancelled`;
  }

  return `[DGX] Workflow ${event.workflowId} ${phase}`;
}

function runDescription(event: WorkflowRunTelemetryEvent): string {
  const parts: string[] = [`run: ${event.runId}`];

  if (typeof event.completedSteps === "number") {
    parts.push(`steps: ${event.completedSteps}`);
  }

  if (typeof event.durationMs === "number") {
    parts.push(`duration: ${event.durationMs}ms`);
  }

  return parts.join(" • ");
}

function stepDescription(event: StepTelemetryEvent): string {
  const parts: string[] = [
    `run: ${event.runId}`,
    `workflow: ${event.workflowId}`,
    `step: ${event.stepIndex}`,
    `attempt: ${event.attempt}`
  ];

  if (event.logicalKey) {
    parts.push(`key: ${event.logicalKey}`);
  }

  if (typeof event.durationMs === "number") {
    parts.push(`duration: ${event.durationMs}ms`);
  }

  if (event.notes) {
    parts.push(`notes: ${event.notes}`);
  }

  return parts.join(" • ");
}

function safeNotify(notify: (notification: HudNotification) => void, notification: HudNotification): void {
  try {
    notify(notification);
  } catch {
    // ignore notification errors to avoid breaking telemetry flow
  }
}

export function sanitizeTelemetryValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeTelemetryValue(entry));
  }

  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};

    Object.entries(input).forEach(([key, entry]) => {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        output[key] = maskValue(entry);
        return;
      }

      output[key] = sanitizeTelemetryValue(entry);
    });

    return output;
  }

  return value;
}
