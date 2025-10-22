import {
  cancelRun,
  runWorkflow,
  type WorkflowResolver,
  type WorkflowRunOutcome,
  type WorkflowRunTelemetryEvent,
  type WorkflowRuntimeLogger,
  type WorkflowRuntimeOptions
} from "../workflows/src/engine/runtime";
import { createDefaultScheduler, type WorkflowScheduler } from "../workflows/src/engine/scheduler";
import { createWorkflowResolverBridge, type WorkflowResolverBridgeOptions } from "../workflows/src/engine/resolver";
import { createContextManager } from "../workflows/src/engine/context";
import {
  WorkflowTelemetryAdapter,
  type WorkflowTelemetryAdapterOptions,
  type WorkflowTelemetryObserver
} from "../workflows/src/telemetry/runtime";
import {
  WorkflowEventRecorder,
  type WorkflowTimeline
} from "../workflows/src/telemetry/recorder";
import {
  InMemoryWorkflowContext,
  type WorkflowDefinition,
  type WorkflowHandlers,
  type WorkflowContext
} from "../workflows/src/types";
import type { SelectorMap } from "../selectors/types";
import type { HudNotification } from "../menu/hud";
import { createHudTelemetryObserver, type HudObserverOptions } from "./telemetry-observers";

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
  telemetryObservers?: WorkflowTelemetryObserver[];
  telemetryRecorder?: WorkflowEventRecorder;
  resolverOptions?: Partial<Omit<WorkflowResolverBridgeOptions, "selectorMap">>;
  logger?: WorkflowRuntimeLogger;
  createContext?: WorkflowRuntimeOptions["createContext"];
  hudTelemetry?: WorkflowHudTelemetryConfig;
}

export interface WorkflowCommand {
  id: string;
  label: string;
  description?: string;
  run: () => Promise<WorkflowRunOutcome>;
}

export interface WorkflowHudTelemetryConfig {
  enabled?: boolean;
  includeAttempts?: boolean;
  notify?: (notification: HudNotification) => void;
}

export class WorkflowRegistry {
  readonly scheduler: WorkflowScheduler;
  readonly resolver: WorkflowResolver;
  readonly telemetry: WorkflowTelemetryAdapter;
  readonly logger?: WorkflowRuntimeLogger;
  readonly telemetryRecorder: WorkflowEventRecorder;

  #workflows = new Map<string, WorkflowRegistration>();
  #handlers: WorkflowHandlers;
  #createContext?: WorkflowRuntimeOptions["createContext"];

  constructor(options: WorkflowRegistryOptions) {
    this.scheduler = options.scheduler ?? createDefaultScheduler();
    this.resolver = options.resolver ?? createWorkflowResolverBridge({
      selectorMap: options.selectorMap,
      ...options.resolverOptions
    } satisfies WorkflowResolverBridgeOptions);
    this.logger = options.logger;
    this.#handlers = options.handlers;
    this.#createContext = options.createContext;

    this.telemetryRecorder = options.telemetryRecorder ?? new WorkflowEventRecorder();

    const defaultObservers: WorkflowTelemetryObserver[] = [
      this.telemetryRecorder,
      ...resolveTelemetryObservers(options.telemetryObservers)
    ];

    const hudObserver = resolveHudObserver(options.hudTelemetry);

    if (hudObserver) {
      defaultObservers.push(hudObserver);
    }

    if (options.telemetry) {
      this.telemetry = options.telemetry;
      defaultObservers.forEach((observer) => {
        this.telemetry.addObserver(observer);
      });
    } else {
      const existingObservers = options.telemetryOptions?.observers ?? [];
      const telemetryOptions: WorkflowTelemetryAdapterOptions = {
        ...options.telemetryOptions,
        observers: [...existingObservers, ...defaultObservers]
      } satisfies WorkflowTelemetryAdapterOptions;
      this.telemetry = new WorkflowTelemetryAdapter(telemetryOptions);
    }
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

  getTimeline(runId: string): WorkflowTimeline {
    return this.telemetryRecorder.timeline(runId);
  }

  listRuns(): WorkflowRunTelemetryEvent[] {
    return this.telemetryRecorder.listRuns();
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

function resolveTelemetryObservers(observers: WorkflowTelemetryObserver[] | undefined): WorkflowTelemetryObserver[] {
  return observers ? observers.slice() : [];
}

function resolveHudObserver(config: WorkflowHudTelemetryConfig | undefined): WorkflowTelemetryObserver | undefined {
  const enabled = config?.enabled ?? true;

  if (!enabled) {
    return undefined;
  }

  const options: HudObserverOptions = {
    includeAttempts: config?.includeAttempts,
    notify: config?.notify
  } satisfies HudObserverOptions;

  return createHudTelemetryObserver(options);
}
