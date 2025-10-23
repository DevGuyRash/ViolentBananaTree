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
  type WorkflowContext,
  type WorkflowContextSnapshot
} from "../workflows/src/types";
import type { SelectorMap } from "../selectors/types";
import type { HudNotification } from "../menu/hud";
import { createHudTelemetryObserver, type HudObserverOptions } from "./telemetry-observers";
import type { RuntimeTimingOverrides } from "../workflows/src/config";

export interface WorkflowRunDefaults {
  context?: WorkflowContextSnapshot;
  timing?: RuntimeTimingOverrides;
  metadata?: Record<string, unknown>;
}

export interface WorkflowRegistration {
  workflow: WorkflowDefinition;
  handlers?: WorkflowHandlers;
  defaults?: WorkflowRunDefaults;
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
  defaults?: WorkflowRunDefaults;
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

export interface PageModuleWorkflow {
  definition: WorkflowDefinition;
  handlers?: WorkflowHandlers;
  defaults?: WorkflowRunDefaults;
}

export interface PageModule {
  id: string;
  label?: string;
  selectors: SelectorMap;
  workflows: PageModuleWorkflow[];
  matches?: (url: URL) => boolean;
  defaults?: WorkflowRunDefaults;
  telemetryObservers?: WorkflowTelemetryObserver[];
  hudTelemetry?: WorkflowHudTelemetryConfig;
  resolverOptions?: Partial<Omit<WorkflowResolverBridgeOptions, "selectorMap">>;
}

export interface CreateModuleRegistryOptions {
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
  defaults?: WorkflowRunDefaults;
}

type StoredWorkflowRegistration = {
  workflow: WorkflowDefinition;
  handlers?: WorkflowHandlers;
  defaults?: WorkflowRunDefaults;
};

export class WorkflowRegistry {
  readonly scheduler: WorkflowScheduler;
  readonly resolver: WorkflowResolver;
  readonly telemetry: WorkflowTelemetryAdapter;
  readonly logger?: WorkflowRuntimeLogger;
  readonly telemetryRecorder: WorkflowEventRecorder;

  #workflows = new Map<string, StoredWorkflowRegistration>();
  #handlers: WorkflowHandlers;
  #createContext?: WorkflowRuntimeOptions["createContext"];
  #defaults?: WorkflowRunDefaults;

  constructor(options: WorkflowRegistryOptions) {
    this.scheduler = options.scheduler ?? createDefaultScheduler();
    this.resolver = options.resolver ?? createWorkflowResolverBridge({
      selectorMap: options.selectorMap,
      ...options.resolverOptions
    } satisfies WorkflowResolverBridgeOptions);
    this.logger = options.logger;
    this.#handlers = options.handlers;
    this.#createContext = options.createContext;
    this.#defaults = cloneDefaults(options.defaults);

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

    this.#workflows.set(registration.workflow.id, cloneRegistration(registration));
  }

  list(): WorkflowRegistration[] {
    return Array.from(this.#workflows.values()).map(cloneRegistration);
  }

  get(workflowId: string): WorkflowRegistration | undefined {
    const stored = this.#workflows.get(workflowId);

    if (!stored) {
      return undefined;
    }

    return cloneRegistration(stored);
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

    const {
      context: providedContext,
      createContext: providedCreateContext,
      timingOverrides: providedTimingOverrides,
      metadata: providedMetadata,
      initialContext: providedInitialContext,
      ...remainingOptions
    } = options;

    const contextFactory = providedCreateContext ?? this.#createContext;
    const runtimeContext = resolveContext(providedContext, contextFactory);
    const manager = createContextManager(runtimeContext);

    const timingOverrides = mergeTimingOverrides(
      this.#defaults?.timing,
      registration.defaults?.timing,
      providedTimingOverrides
    );

    const metadata = mergeMetadataRecords(
      this.#defaults?.metadata,
      registration.defaults?.metadata,
      providedMetadata
    );

    const initialContext = mergeContextSnapshots(
      this.#defaults?.context,
      registration.defaults?.context,
      providedInitialContext
    );

    return runWorkflow(registration.workflow, {
      handlers: registration.handlers ?? this.#handlers,
      scheduler: this.scheduler,
      resolver: this.resolver,
      telemetry: this.telemetry,
      logger: this.logger,
      context: manager.context,
      createContext: contextFactory,
      timingOverrides,
      metadata,
      initialContext,
      ...remainingOptions
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

export function createWorkflowRegistryForModule(module: PageModule, options: CreateModuleRegistryOptions): WorkflowRegistry {
  const registryDefaults = mergeRunDefaults(
    options.defaults,
    module.defaults,
    {
      metadata: {
        moduleId: module.id,
        moduleLabel: module.label ?? module.id
      }
    }
  );

  const telemetryObservers = mergeObserverLists(options.telemetryObservers, module.telemetryObservers);
  const resolverOptions = mergeResolverOptions(options.resolverOptions, module.resolverOptions);

  const registry = new WorkflowRegistry({
    selectorMap: module.selectors,
    handlers: options.handlers,
    scheduler: options.scheduler,
    resolver: options.resolver,
    telemetry: options.telemetry,
    telemetryOptions: options.telemetryOptions,
    telemetryObservers,
    telemetryRecorder: options.telemetryRecorder,
    resolverOptions,
    logger: options.logger,
    createContext: options.createContext,
    hudTelemetry: module.hudTelemetry ?? options.hudTelemetry,
    defaults: registryDefaults
  });

  module.workflows.forEach((workflow) => {
    registry.register({
      workflow: workflow.definition,
      handlers: workflow.handlers,
      defaults: workflow.defaults
    });
  });

  return registry;
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

function mergeRunDefaults(...entries: Array<WorkflowRunDefaults | undefined>): WorkflowRunDefaults | undefined {
  const context = mergeContextSnapshots(...entries.map((entry) => entry?.context));
  const timing = mergeTimingOverrides(...entries.map((entry) => entry?.timing));
  const metadata = mergeMetadataRecords(...entries.map((entry) => entry?.metadata));

  if (!context && !timing && !metadata) {
    return undefined;
  }

  const next: WorkflowRunDefaults = {};

  if (context) {
    next.context = context;
  }

  if (timing) {
    next.timing = timing;
  }

  if (metadata) {
    next.metadata = metadata;
  }

  return next;
}

function mergeTimingOverrides(
  ...entries: Array<RuntimeTimingOverrides | undefined>
): RuntimeTimingOverrides | undefined {
  let result: RuntimeTimingOverrides | undefined;

  entries.forEach((entry) => {
    if (!entry) {
      return;
    }

    result = { ...(result ?? {}), ...entry };
  });

  return result;
}

function mergeContextSnapshots(
  ...snapshots: Array<WorkflowContextSnapshot | undefined>
): WorkflowContextSnapshot | undefined {
  let result: WorkflowContextSnapshot | undefined;

  snapshots.forEach((snapshot) => {
    if (!snapshot) {
      return;
    }

    result = { ...(result ?? {}), ...snapshot };
  });

  return result;
}

function mergeMetadataRecords(
  ...records: Array<Record<string, unknown> | undefined>
): Record<string, unknown> | undefined {
  let result: Record<string, unknown> | undefined;

  records.forEach((record) => {
    if (!record) {
      return;
    }

    result = { ...(result ?? {}), ...record };
  });

  return result;
}

function mergeObserverLists(
  ...lists: Array<WorkflowTelemetryObserver[] | undefined>
): WorkflowTelemetryObserver[] | undefined {
  const merged: WorkflowTelemetryObserver[] = [];

  lists.forEach((list) => {
    list?.forEach((observer) => {
      if (!merged.includes(observer)) {
        merged.push(observer);
      }
    });
  });

  return merged.length > 0 ? merged : undefined;
}

function mergeResolverOptions(
  base: Partial<Omit<WorkflowResolverBridgeOptions, "selectorMap">> | undefined,
  overrides: Partial<Omit<WorkflowResolverBridgeOptions, "selectorMap">> | undefined
): Partial<Omit<WorkflowResolverBridgeOptions, "selectorMap">> | undefined {
  if (!base && !overrides) {
    return undefined;
  }

  return {
    ...(base ?? {}),
    ...(overrides ?? {})
  } satisfies Partial<Omit<WorkflowResolverBridgeOptions, "selectorMap">>;
}

function cloneDefaults(defaults: WorkflowRunDefaults | undefined): WorkflowRunDefaults | undefined {
  if (!defaults) {
    return undefined;
  }

  const clone: WorkflowRunDefaults = {};

  if (defaults.context) {
    clone.context = { ...defaults.context };
  }

  if (defaults.timing) {
    clone.timing = { ...defaults.timing };
  }

  if (defaults.metadata) {
    clone.metadata = { ...defaults.metadata };
  }

  return clone;
}

function cloneRegistration(entry: WorkflowRegistration | StoredWorkflowRegistration): WorkflowRegistration {
  return {
    workflow: entry.workflow,
    handlers: entry.handlers,
    defaults: cloneDefaults(entry.defaults)
  } satisfies WorkflowRegistration;
}
