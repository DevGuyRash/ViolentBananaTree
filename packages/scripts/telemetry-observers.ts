import { pushHudNotification, type HudNotification, type HudLevel } from "../menu/hud";
import type { StepTelemetryEvent } from "../workflows/src/types";
import type { WorkflowRunTelemetryEvent } from "../workflows/src/engine/runtime";
import type { RunEventPhase, WorkflowTelemetryObserver } from "../workflows/src/telemetry/runtime";

export interface HudObserverOptions {
  notify?: (notification: HudNotification) => void;
  includeAttempts?: boolean;
}

export function createHudTelemetryObserver(options: HudObserverOptions = {}): WorkflowTelemetryObserver {
  const notify = options.notify ?? pushHudNotification;
  const includeAttempts = options.includeAttempts ?? true;

  return {
    onRun(event, phase) {
      notify(buildRunNotification(event, phase));
    },
    onSteps(events) {
      events.forEach((event) => {
        if (event.status === "failure" || event.status === "success" || (includeAttempts && event.status === "attempt")) {
          notify(buildStepNotification(event));
        }
      });
    }
  } satisfies WorkflowTelemetryObserver;
}

function buildRunNotification(event: WorkflowRunTelemetryEvent, phase: RunEventPhase): HudNotification {
  const level: HudLevel = resolveRunLevel(event);
  const title = runTitle(event, phase);
  const metadata = {
    ...event,
    phase
  } satisfies Record<string, unknown>;

  return {
    id: `workflow-run-${event.runId}-${phase}`,
    title,
    description: runDescription(event),
    level,
    metadata
  } satisfies HudNotification;
}

function buildStepNotification(event: StepTelemetryEvent): HudNotification {
  const level: HudLevel = event.status === "failure" ? "error" : "info";
  const descriptor = stepDescriptor(event);

  return {
    id: `workflow-step-${event.runId}-${event.stepIndex}-${event.status}-${event.attempt}-${event.timestamp}`,
    title: `[DGX] Step ${event.status}`,
    description: descriptor,
    level,
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
  const parts: string[] = [];

  parts.push(`run: ${event.runId}`);

  if (typeof event.completedSteps === "number") {
    parts.push(`steps: ${event.completedSteps}`);
  }

  if (typeof event.durationMs === "number") {
    parts.push(`duration: ${event.durationMs}ms`);
  }

  return parts.join(" • ");
}

function stepDescriptor(event: StepTelemetryEvent): string {
  const parts: string[] = [];

  parts.push(`run: ${event.runId}`);
  parts.push(`workflow: ${event.workflowId}`);
  parts.push(`step: ${event.stepIndex}`);
  parts.push(`attempt: ${event.attempt}`);

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
