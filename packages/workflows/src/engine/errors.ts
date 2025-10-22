import { type StepErrorPayload, type WorkflowStep } from "../../types";

export type StepErrorReason = StepErrorPayload["reason"] | "cancelled";

export interface StepErrorDetails extends StepErrorPayload {
  reason: StepErrorReason;
}

export class StepError extends Error {
  readonly reason: StepErrorReason;
  readonly stepId?: string;
  readonly stepKind: StepErrorPayload["stepKind"];
  readonly logicalKey?: string;
  readonly attempts?: number;
  readonly elapsedMs?: number;
  readonly data?: Record<string, unknown>;
  readonly cause?: unknown;

  constructor(details: StepErrorDetails, cause?: unknown) {
    super(details.message);
    this.name = "StepError";
    this.reason = details.reason;
    this.stepId = details.stepId;
    this.stepKind = details.stepKind;
    this.logicalKey = details.logicalKey;
    this.attempts = details.attempts;
    this.elapsedMs = details.elapsedMs;
    this.data = details.data;
    this.cause = cause;
  }

  static fromUnknown(
    step: WorkflowStep,
    reason: StepErrorReason,
    error: unknown,
    metadata: Partial<Omit<StepErrorDetails, "reason" | "message" | "stepKind">> = {}
  ): StepError {
    return new StepError(
      {
        reason,
        message: error instanceof Error ? error.message : String(error),
        stepKind: step.kind,
        stepId: step.id,
        logicalKey: hasLogicalKey(step) ? step.key : undefined,
        ...metadata
      },
      error
    );
  }

  toPayload(): StepErrorPayload {
    return {
      reason: this.reason,
      message: this.message,
      stepId: this.stepId,
      stepKind: this.stepKind,
      logicalKey: this.logicalKey,
      attempts: this.attempts,
      elapsedMs: this.elapsedMs,
      data: this.data
    };
  }
}

export function buildTimeoutError(step: WorkflowStep, timeoutMs: number, attempts: number): StepError {
  return new StepError({
    reason: "timeout",
    message: `Step '${step.kind}' timed out after ${timeoutMs}ms`,
    stepKind: step.kind,
    stepId: step.id,
    logicalKey: hasLogicalKey(step) ? step.key : undefined,
    attempts,
    data: { timeoutMs }
  });
}

export function buildResolverMissError(
  step: WorkflowStep,
  logicalKey: string,
  attempts: number,
  data?: Record<string, unknown>
): StepError {
  return new StepError({
    reason: "resolver-miss",
    message: `Unable to resolve logical key '${logicalKey}'`,
    stepKind: step.kind,
    stepId: step.id,
    logicalKey,
    attempts,
    data
  });
}

export function buildCancellationError(step: WorkflowStep, attempts: number): StepError {
  return new StepError({
    reason: "cancelled",
    message: `Step '${step.kind}' cancelled`,
    stepKind: step.kind,
    stepId: step.id,
    logicalKey: hasLogicalKey(step) ? step.key : undefined,
    attempts
  });
}

export function buildFailureError(step: WorkflowStep, error: unknown, attempts: number): StepError {
  return StepError.fromUnknown(step, "unknown", error, { attempts });
}

function hasLogicalKey(step: WorkflowStep): step is WorkflowStep & { key: string } {
  return typeof (step as { key?: unknown }).key === "string";
}
