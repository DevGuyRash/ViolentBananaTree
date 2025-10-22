import {
  cancelRun,
  runWorkflow,
  type WorkflowResolver,
  type WorkflowRunOutcome,
  type WorkflowRuntimeLogger,
  type WorkflowRuntimeOptions
} from "../workflows/src/engine/runtime";
import { createDefaultScheduler, type WorkflowScheduler } from "../workflows/src/engine/scheduler";
import { createWorkflowResolverBridge, type WorkflowResolverBridgeOptions } from "../workflows/src/engine/resolver";
import { createContextManager } from "../workflows/src/engine/context";
import { WorkflowTelemetryAdapter, type WorkflowTelemetryAdapterOptions } from "../workflows/src/telemetry/runtime";
import {
  InMemoryWorkflowContext,
  type WorkflowDefinition,
  type WorkflowHandlers,
  type WorkflowContext
} from "../workflows/src/types";
import type { SelectorMap } from "../selectors/types";

export interface WorkflowRegistration {
  workflow: WorkflowDefinition;
  handlers?: WorkflowHandlers;
}

export interface WorkflowRegistryOptions {
  selectorMap: SelectorMap;
  handlers: WorkflowHandlers;
  scheduler?: WorkflowScheduler;
  resolver?: WorkflowResolver;
  telemetry?: WorkflowTelemetryAdapter;
  telemetryOptions?: WorkflowTelemetryAdapterOptions;
  resolverOptions?: Partial<Omit<WorkflowResolverBridgeOptions, "selectorMap">>;
  logger?: WorkflowRuntimeLogger;
  createContext?: WorkflowRuntimeOptions["createContext"];
}

export interface WorkflowCommand {
  id: string;
  label: string;
  description?: string;
  run: () => Promise<WorkflowRunOutcome>;
}

export class WorkflowRegistry {
  readonly scheduler: WorkflowScheduler;
  readonly resolver: WorkflowResolver;
  readonly telemetry: WorkflowTelemetryAdapter;
  readonly logger?: WorkflowRuntimeLogger;

  #workflows = new Map<string, WorkflowRegistration>();
  #handlers: WorkflowHandlers;
  #createContext?: WorkflowRuntimeOptions["createContext"];

  constructor(options: WorkflowRegistryOptions) {
    this.scheduler = options.scheduler ?? createDefaultScheduler();
    this.telemetry = options.telemetry ?? new WorkflowTelemetryAdapter(options.telemetryOptions);
    this.resolver = options.resolver ?? createWorkflowResolverBridge({
      selectorMap: options.selectorMap,
      ...options.resolverOptions
    } satisfies WorkflowResolverBridgeOptions);
    this.logger = options.logger;
    this.#handlers = options.handlers;
    this.#createContext = options.createContext;
  }

  register(registration: WorkflowRegistration): void {
    if (this.#workflows.has(registration.workflow.id)) {
      throw new Error(`Workflow '${registration.workflow.id}' already registered`);
    }

    this.#workflows.set(registration.workflow.id, registration);
  }

  list(): WorkflowRegistration[] {
    return Array.from(this.#workflows.values());
  }

  toCommands(): WorkflowCommand[] {
    return this.list().map((registration) => {
      const workflow = registration.workflow;
      return {
        id: workflow.id,
        label: workflow.label ?? workflow.id,
        description: workflow.description,
        run: () => this.run(workflow.id)
      };
    });
  }

  async run(workflowId: string, options: Partial<WorkflowRuntimeOptions> = {}): Promise<WorkflowRunOutcome> {
    const registration = this.#workflows.get(workflowId);

    if (!registration) {
      throw new Error(`Workflow '${workflowId}' is not registered`);
    }

    const runtimeContext = resolveContext(options.context, options.createContext ?? this.#createContext);
    const manager = createContextManager(runtimeContext);

    return runWorkflow(registration.workflow, {
      handlers: registration.handlers ?? this.#handlers,
      scheduler: this.scheduler,
      resolver: this.resolver,
      telemetry: this.telemetry,
      logger: this.logger,
      context: manager.context,
      createContext: this.#createContext,
      ...options
    });
  }

  cancel(runId: string): boolean {
    return cancelRun(runId);
  }
}

function resolveContext(
  provided: WorkflowContext | undefined,
  factory?: WorkflowRuntimeOptions["createContext"]
): WorkflowContext {
  if (provided) {
    return provided;
  }

  if (factory) {
    return factory();
  }

  return new InMemoryWorkflowContext();
}
