# Design Document

## Overview

The DGX workflow engine transforms recorder output and hand-authored DSL definitions into reliable, observable browser automations. This design formalizes the engine runtime, declarative step schema, configuration defaults, and telemetry adapters that let page modules execute workflows with consistent timing, retries, context access, and logical-key resolution while keeping HUD and recorder tooling in sync.

## Steering Document Alignment

### Technical Standards (tech.md)
- Adheres to the TypeScript-first stack with strict typing inside `packages/workflows`.
- Reuses existing Vite/WXT build outputs by keeping runtime browser-safe and free of `eval`.
- Integrates with GM storage, BroadcastChannel, and `[DGX]` logging conventions for observability.

### Project Structure (structure.md)
- Places DSL types, config, and engine code under `packages/workflows/src` with dedicated barrels in `index.ts`.
- Consumes selector resolution from `packages/core` and context store from `packages/context`, maintaining modular package boundaries.
- Exposes workflow APIs through page modules in `packages/scripts/<site>/<page>.ts`, aligning with existing registry patterns.

## Code Reuse Analysis
- `@core/resolve` supplies logical-key lookup with stability metadata used during step execution.
- `@core/utils/wait`, `scroll`, and `collect` provide low-level DOM helpers invoked by engine actions.
- `@context/store` offers TTL-aware context management injected into the engine.
- HUD (`@menu`) and recorder (`@recorder`) leverage the same telemetry events and type definitions for timeline playback and export.

### Existing Components to Leverage
- **SelectorResolver (`@core/resolve`)**: Resolves logical keys with strategy ordering; engine wraps it for workflow steps.
- **ContextStore (`@context/store`)**: Manages cross-tab state referenced by `setContext`, `fromCtx`, and `foreach` loops.
- **Wait Utilities (`@core/utils/wait`)**: Implements polling with configurable intervals backing `waitFor`, `waitText`, and retry loops.
- **Scroll & List Utilities (`@core/utils/scroll`, `@core/utils/collect`)**: Power `scrollUntil` and `collectList` step kinds.

### Integration Points
- **HUD Timeline**: Subscribes to engine telemetry stream to render per-step status and durations.
- **Recorder Export**: Serializes recorded actions into DSL `Step[]` using shared type definitions.
- **Telemetry Adapter**: Emits structured events to console (`[DGX]`) and optional future sinks.
- **Workflow Registry**: Page modules register workflows with engine factory to ensure step definitions map to selector maps.

## Architecture

The engine is composed of four cooperating modules:
1. **DSL Types & Validator**: TypeScript union definitions plus runtime guards ensuring recorder output aligns with engine expectations.
2. **Execution Engine**: Runs steps sequentially with support for nested workflows, branching, retries, and context interaction.
3. **Action Executors**: Encapsulate DOM side effects (click/type/select/etc.) and reuse shared utilities.
4. **Telemetry & Error Layer**: Captures structured events, errors, and metrics for HUD, recorder, and potential analytics.

### Modular Design Principles
- **Single File Responsibility**: `types.ts` declares DSL contracts, `engine.ts` orchestrates execution, `actions/*.ts` isolate action-specific behavior, and `telemetry.ts` handles logging.
- **Component Isolation**: Execution engine depends on injected resolver, context store, and telemetry adapters rather than importing concrete implementations.
- **Service Layer Separation**: Page modules build workflow descriptors; the engine consumes descriptors without knowledge of UI/hotkeys.
- **Utility Modularity**: Each step kind delegates to specialized helpers (e.g., `executeClick`, `executeWaitFor`) avoiding monolithic switch blocks.

```mermaid
graph TD
    Recorder[Recorder Export] -->|Step[]| Types[DSL Types]
    Types --> Engine[Workflow Engine]
    Engine --> Actions[Action Executors]
    Engine --> Telemetry[Telemetry Adapter]
    Actions --> Resolver[Logical Selector Resolver]
    Actions --> Context[Context Store]
    Telemetry --> HUD[HUD Timeline]
    Telemetry --> Console[[DGX Logs]]
```

## Components and Interfaces

### DSL Types (`types.ts`)
- **Purpose:** Define `Step`, `Workflow`, `WorkflowConfig`, and telemetry payload types.
- **Interfaces:** `Step`, `WorkflowDefinition`, `WorkflowRunOptions`, `StepError`, `StepTelemetry`.
- **Dependencies:** Type-only references to core utility types; no runtime imports.
- **Reuses:** Aligns with recorder-generated TypeScript types to ensure interoperability.

### Workflow Engine (`engine.ts`)
- **Purpose:** Execute workflows sequentially or recursively with retries, conditionals, and context operations.
- **Interfaces:** `runWorkflow(workflowId, opts)`, `runSteps(steps, scope)`, `cancelRun(runId)`.
- **Dependencies:** Injected `SelectorResolver`, `ContextStore`, `TelemetryAdapter`, `DefaultConfig`.
- **Reuses:** Wait utilities, scroll helpers, and context store adapters from existing packages.

### Action Executors (`actions/*.ts`)
- **Purpose:** Implement side-effect logic for each step kind (click, type, select, waitFor, assert, foreach, log, etc.).
- **Interfaces:** `execute(step, env): Promise<StepResult>` per action type.
- **Dependencies:** DOM utility helpers, resolver, context store, sanitizers.
- **Reuses:** `@core/utils/wait`, `@core/utils/scroll`, `@core/utils/collect`, `@core/utils/dom`.

### Telemetry Adapter (`telemetry.ts`)
- **Purpose:** Normalize engine events (start, attempt, success, failure) into `[DGX]` console logs and HUD timeline entries.
- **Interfaces:** `record(event: StepTelemetry)`, `flush(runId)`, `onUpdate(listener)`.
- **Dependencies:** Sanitizer utilities, HUD event bus, optional analytics pipeline hook.
- **Reuses:** Logging conventions defined in tech steering.

### Config & Defaults (`config.ts`)
- **Purpose:** Store default timeouts, intervals, retry strategies, and error message templates.
- **Interfaces:** `WorkflowDefaults`, `resolveTimeout(step, overrides)`, `resolveRetryPolicy(step)`.
- **Dependencies:** None beyond TypeScript types.
- **Reuses:** Values sourced from steering (≤150ms polling, ≤8s default timeouts).

### Workflow Registry (`registry.ts`)
- **Purpose:** Map workflow IDs to metadata and step definitions within a page module context.
- **Interfaces:** `registerWorkflows(pageId, workflows)`, `getWorkflow(pageId, workflowId)`.
- **Dependencies:** Page module definitions.
- **Reuses:** Existing `packages/scripts/index.ts` registration pipeline.

## Data Models

### Step
```
type Step =
  | { kind: "click"; key: string; timeout?: number; retries?: number; backoffMs?: number; jitterMs?: number; name?: string; debug?: boolean }
  | { kind: "type"; key: string; text?: string; fromCtx?: string; delayMs?: number; timeout?: number; retries?: number }
  | { kind: "select"; key: string; value?: string; fromCtx?: string; timeout?: number }
  | { kind: "waitFor"; key?: string; css?: string; xpath?: string; text?: string; exact?: boolean; timeout?: number; interval?: number }
  | { kind: "if"; when: Condition; then: Step[]; else?: Step[] }
  | { kind: "foreach"; listCtx: string; as: string; steps: Step[]; concurrency?: number }
  | { kind: "setContext"; path: string; value?: unknown; fromKey?: string; fromText?: string; ttlMs?: number }
  | { kind: "capture"; to: string; from: CaptureSource; sanitize?: boolean }
  | { kind: "assert"; check: Assertion; timeout?: number }
  | { kind: "log"; message: string; level?: "info" | "warn" | "error" }
  | { kind: "delay"; ms: number }
  | { kind: "run"; workflowId: string }
  | { kind: "scrollUntil"; options: ScrollUntilOptions }
  | { kind: "collectList"; options: CollectOptions; toCtx?: string }
  | { kind: "retry"; steps: Step[]; policy?: RetryPolicy }
  | { kind: "hover"; key: string }
  | { kind: "focus"; key: string }
  | { kind: "blur"; key: string };
```

### Workflow Definition
```
type WorkflowDefinition = {
  id: string;
  label: string;
  steps: Step[];
  defaults?: WorkflowDefaults;
  description?: string;
  tags?: string[];
};
```

### StepTelemetry
```
type StepTelemetry = {
  runId: string;
  workflowId: string;
  stepIndex: number;
  stepKind: string;
  logicalKey?: string;
  status: "pending" | "attempt" | "success" | "failure" | "skipped";
  attempt: number;
  timestamp: number;
  durationMs?: number;
  error?: StepError;
  notes?: string;
};
```

## Error Handling

### Error Scenarios
1. **Resolver Miss:** Logical key strategies exhaust without finding an element.
   - **Handling:** Engine emits `failure` telemetry, attaches selector strategies attempted, respects retry policy, and ultimately surfaces `StepError` with actionable message.
   - **User Impact:** HUD shows miss with logical key and stability score; workflow stops unless caller handles error.

2. **Context Access Failure:** `fromCtx` or `foreach` references undefined context path.
   - **Handling:** Engine throws typed error with missing path, allowing fallback steps or abort based on workflow defaults.
   - **User Impact:** HUD surfaces context miss; recorder suggests adding `setContext` or default value.

3. **Timeout:** Wait/action exceeds configured timeout.
   - **Handling:** Engine cancels pending DOM loops, logs timeout with elapsed duration, and returns structured error including default overrides used.
   - **User Impact:** HUD timeline marks step red with timeout reason; telemetry captures for later diagnosis.

4. **Assertion Failure:** Expected condition not satisfied within retries.
   - **Handling:** Engine emits failure telemetry with expected vs actual values and halts workflow by default.
   - **User Impact:** HUD displays assertion context; optional on-fail steps can handle recovery in future iterations.

## Testing Strategy

### Unit Testing
- Cover DSL validators ensuring invalid steps reject at build/test time.
- Mock resolver/context to test engine branching, retries, and telemetry emission.
- Validate each action executor in isolation (click/type/select/assert) using JSDOM or DOM stubs.

### Integration Testing
- Run engine against synthetic DOM fixtures to confirm logical key resolution, context updates, and nested workflow execution.
- Verify telemetry stream consumed by HUD mock to ensure event ordering and payload integrity.
- Exercise recorder export/import loop to confirm type compatibility and default merging.

### End-to-End Testing
- Execute sample workflows in browser automation (Playwright/Cypress) to validate real DOM interactions, scroll behaviors, and timeline feedback through HUD.
- Test failure paths (selector miss, timeout, assertion failure) to ensure error signaling matches acceptance criteria and telemetry captures masked data when required.
