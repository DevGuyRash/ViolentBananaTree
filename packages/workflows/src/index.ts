/**
 * Workflow DSL entry point exposing logical-key types and runtime factories
 * so page modules merge defaults safely per requirements 1.1 and 5.1.
 */
export * from "./types";
export * from "./config";
export { runWorkflow, cancelRun, getRunMetadata, type WorkflowRuntimeOptions } from "./engine/runtime";
export { DefaultWorkflowScheduler, createDefaultScheduler } from "./engine/scheduler";
export type { WorkflowScheduler, WorkflowSchedulerEnvironment, WorkflowSchedulerResult } from "./engine/runtime";
export {
  WorkflowResolverBridge,
  createWorkflowResolverBridge,
  type WorkflowResolverBridgeOptions
} from "./engine/resolver";
export {
  WorkflowTelemetryAdapter,
  type WorkflowTelemetryAdapterOptions,
  type StepEventListener,
  type RunEventListener,
  type RunEventPhase,
  type WorkflowTelemetryObserver
} from "./telemetry/runtime";
export {
  WorkflowEventRecorder,
  type WorkflowTimeline,
  type WorkflowTimelineEvent
} from "./telemetry/recorder";
export {
  createWorkflowTelemetry,
  createHudTelemetryObserver,
  sanitizeTelemetryValue,
  type WorkflowTelemetryBridge,
  type WorkflowTelemetrySetupOptions,
  type WorkflowHudTelemetryOptions
} from "./telemetry";
export {
  createContextManager,
  getContextManager,
  type WorkflowContextManager,
  type WorkflowContextScope,
  type ContextSetOptions
} from "./engine/context";
export { createActionHandlers, type CreateActionHandlersOptions } from "./actions";
