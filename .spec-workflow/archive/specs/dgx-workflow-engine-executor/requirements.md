# Requirements Document

## Introduction

The workflow executor runs declarative DGX workflows produced by the recorder and authored in code. It orchestrates step execution, logical key resolution, and telemetry so script authors and HUD operators can trust that automations respect timing budgets, surface actionable errors, and keep workflow context in sync across retries and nested runs.

## Alignment with Product Vision

The product charter emphasizes recorder-first authoring, selector stability, and observable automation. By enforcing logical key resolution, sane defaults, and telemetry hooks inside the executor, this feature turns DSL definitions into reliable browser actions that honor the goals in `product.md`, stay within the technical constraints in `tech.md`, and preserve the modular package structure defined in `structure.md`.

## Requirements

### Requirement 2.1 — Deterministic Workflow Execution Defaults

**User Story:** As a workflow runner, I want the executor to orchestrate steps with consistent defaults so runs succeed under typical latency while exposing overrides when workflows need custom timing.

#### Acceptance Criteria

1. WHEN a workflow run starts without explicit overrides THEN the executor SHALL apply default polling intervals ≤150ms and default timeouts ≤8000ms per steering budgets, while allowing step-level and workflow-level overrides.
2. WHEN each step completes THEN the executor SHALL capture elapsed duration, context mutations, and resolved logical key metadata so telemetry consumers can display progress accurately.
3. IF a step is awaiting completion (e.g., `waitFor`, `delay`) THEN the executor SHALL honor cancellation hooks and surface a structured status to the caller without leaving dangling timeouts or promises.

### Requirement 2.2 — Logical Key Resolution & Retry Strategy

**User Story:** As an automation maintainer, I want logical selector keys resolved consistently with bounded retries so failures are actionable and repeatable.

#### Acceptance Criteria

1. WHEN a step references a `key` THEN the executor SHALL resolve it through the injected selector resolver, logging each strategy attempt in order of precedence.
2. IF resolution fails AND retries remain THEN the executor SHALL apply exponential backoff with jitter using configured defaults before attempting again, with per-step overrides supported.
3. WHEN retries exhaust or resolution still fails THEN the executor SHALL emit a structured `StepError` that includes the logical key, strategies attempted, elapsed time, and recommended follow-up for HUD/recorder review.

### Requirement 2.3 — Telemetry & Error Reporting

**User Story:** As a HUD observer, I want complete telemetry for workflow runs so I can diagnose progress and failures quickly.

#### Acceptance Criteria

1. WHEN a workflow run starts, each step attempts, succeeds, fails, or is skipped THEN the executor SHALL emit `[DGX]`-prefixed telemetry events containing workflow id, step index, logical key (when present), attempt count, duration, and status for HUD and recorder consumers.
2. IF telemetry adapters are not provided THEN the executor SHALL safely noop without throwing while still returning run status and logs to the caller.
3. WHEN an error occurs THEN telemetry SHALL include sanitized payloads that mask sensitive context values using existing sanitizer utilities before reaching HUD or recorder logs.

### Requirement 3.1 — Control Flow & Context Coordination

**User Story:** As a script author, I want the executor to handle control flow and context updates reliably so complex workflows remain maintainable.

#### Acceptance Criteria

1. WHEN executing control flow steps (`if`, `foreach`, `run`) THEN the executor SHALL evaluate conditions or iterate using snapshot isolation so nested workflows cannot corrupt parent state unexpectedly.
2. IF a `foreach` iteration or nested `run` step throws THEN the executor SHALL bubble the structured error, mark remaining steps as skipped, and flush telemetry to the HUD before returning.
3. WHEN `setContext` or `capture` steps mutate workflow context THEN updates SHALL propagate through the injected context store with TTL handling and be visible to subsequent steps within the same run.

## Non-Functional Requirements

### Code Architecture and Modularity
- Execution core SHALL reside under `packages/workflows/src/engine` with helpers split into resolver bridge, control flow, and telemetry modules.
- Executor SHALL accept injected interfaces (resolver, telemetry, context, logger) to keep packages loosely coupled and testable.
- Runtime SHALL expose typed interfaces aligning with DSL `WorkflowDefinition` so recorder exports compile without additional adapters.

### Performance
- Default polling intervals SHALL not exceed 150ms; retries SHALL halt within configured timeout caps to respect the 8s budget.
- Step resolution SHALL avoid redundant DOM queries by caching resolved elements per attempt when safe.
- Telemetry emission SHALL batch HUD updates to animation frames to prevent UI jank during rapid step execution.

### Security
- Telemetry and logs SHALL mask values flagged as sensitive and avoid dumping raw DOM nodes or HTML fragments.
- Executor SHALL never execute dynamic script strings; all actions route through predefined action executors.

### Reliability
- Executor SHALL expose cancellation semantics for long-running steps and ensure context snapshots survive errors.
- Structured error envelopes SHALL include breadcrumb trails of nested workflows to accelerate diagnosis.

### Usability
- Telemetry payloads SHALL include human-readable `step.name` when provided for HUD display.
- Default error messages SHALL reference logical keys and suggested recovery steps consistent with recorder guidance.
