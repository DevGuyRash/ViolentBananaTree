import type { ResolveResult } from "../core/resolve";

export type WorkflowContextSnapshot = Record<string, unknown>;

export interface WorkflowContext {
  readonly state: WorkflowContextSnapshot;
  get<T = unknown>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  merge(values: WorkflowContextSnapshot): void;
  snapshot(): WorkflowContextSnapshot;
}

export class InMemoryWorkflowContext implements WorkflowContext {
  #state: WorkflowContextSnapshot;

  constructor(initial?: WorkflowContextSnapshot) {
    this.#state = { ...(initial ?? {}) };
  }

  get<T = unknown>(key: string): T | undefined {
    return this.#state[key] as T | undefined;
  }

  set(key: string, value: unknown): void {
    this.#state[key] = value;
  }

  delete(key: string): void {
    delete this.#state[key];
  }

  merge(values: WorkflowContextSnapshot): void {
    Object.entries(values).forEach(([key, value]) => {
      this.#state[key] = value;
    });
  }

  snapshot(): WorkflowContextSnapshot {
    return { ...this.#state };
  }

  get state(): WorkflowContextSnapshot {
    return this.snapshot();
  }
}

export type WorkflowStepCommon = {
  id?: string;
  label?: string;
  description?: string;
  key?: string;
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  jitterMs?: number;
};

export type WorkflowStep = WorkflowStepCommon & {
  kind: string;
  [key: string]: unknown;
};

export type WorkflowDefinition = {
  id: string;
  label?: string;
  steps: WorkflowStep[];
};

export type WorkflowStepExecutionArgs = {
  step: WorkflowStep;
  attempt: number;
  retriesRemaining: number;
  context: WorkflowContext;
  resolveResult: ResolveResult | null;
};

export type WorkflowStepHandler = (
  args: WorkflowStepExecutionArgs
) => Promise<void> | void;

export type WorkflowHandlers = Record<string, WorkflowStepHandler>;

export type WorkflowRuntimeHooks = {
  beforeStep?: (args: WorkflowStepExecutionArgs) => void;
  afterStep?: (args: WorkflowStepExecutionArgs) => void;
  onError?: (error: unknown, args: WorkflowStepExecutionArgs) => void;
};
