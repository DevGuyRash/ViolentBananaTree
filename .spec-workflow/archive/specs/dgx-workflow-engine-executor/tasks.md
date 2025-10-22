# Tasks Document

- [x] 1. Implement workflow executor runtime coordinator in `packages/workflows/src/engine/runtime.ts`
  - File: packages/workflows/src/engine/runtime.ts
  - Create the public `runWorkflow`/`cancelRun` APIs, hydrate dependency injections (resolver, context, telemetry, logger), merge default timing/retry configuration, and maintain run-level metadata plus context snapshots.
  - _Leverage: packages/workflows/src/types.ts, packages/core/utils/wait.ts, packages/context/src/store.ts_
  - _Requirements: 2.1, 2.2_
  - _Prompt: Role: Workflow Runtime Engineer | Task: Build the runtime coordinator that bootstraps runs, merges defaults, wires dependencies, and exposes cancellation per requirements 2.1 and 2.2 | Restrictions: Keep runtime pure TypeScript without DOM access, ensure dependency injection for resolver/context/telemetry, maintain strict typing throughout_
  - _Success: `runWorkflow` executes sequentially with default intervals/timeouts, cancellation works, context snapshots returned, TypeScript passes without errors_

- [x] 2. Develop step scheduler and control-flow executor in `packages/workflows/src/engine/scheduler.ts`
  - File: packages/workflows/src/engine/scheduler.ts
  - Implement per-step execution with retry/backoff, timeout guards, and branching support for `if`, `foreach`, and nested `run` steps. Track attempt counts and mark skipped steps on failure.
  - _Leverage: packages/core/utils/wait.ts, packages/workflows/src/types.ts, packages/workflows/src/engine/runtime.ts_
  - _Requirements: 2.1, 2.2, 3.1_
  - _Prompt: Role: Asynchronous Orchestration Specialist | Task: Build the step scheduler that enforces retry policies, evaluates control flow, and coordinates nested workflows per requirements 2.1–3.1 | Restrictions: Reuse shared helpers instead of duplicating waits/backoff, keep each helper ≤150 lines, ensure recursion does not leak context scopes_
  - _Success: Scheduler handles sequential and nested steps, obeys retry/backoff defaults, isolates context scopes for branches, returns structured results consumed by runtime_

- [x] 3. Create logical key resolver bridge in `packages/workflows/src/engine/resolver.ts`
  - File: packages/workflows/src/engine/resolver.ts
  - Adapt the selector resolver to executor needs: attempt logging, stability metadata capture, caching per attempt, and structured error construction when misses occur.
  - _Leverage: packages/core/resolve.ts, packages/core/resolve-telemetry.ts, packages/workflows/src/telemetry/runtime.ts_
  - _Requirements: 2.2_
  - _Prompt: Role: Selector Stability Engineer | Task: Implement the resolver bridge that resolves logical keys, applies exponential backoff hints, and surfaces `WorkflowResolverMissError` payloads per requirement 2.2 | Restrictions: Do not bypass resolver ordering, ensure telemetry logs each attempt with logical key, avoid global state_
  - _Success: Resolver bridge provides resolved elements and metadata to scheduler, emits attempt telemetry, and returns typed errors when strategies exhaust_

- [x] 4. Implement telemetry adapter in `packages/workflows/src/telemetry/runtime.ts`
  - File: packages/workflows/src/telemetry/runtime.ts
  - Provide functions to emit `[DGX]` console logs, stream updates to HUD, batch step events, and sanitize sensitive payloads before delivery.
  - _Leverage: packages/menu/src/hud.ts, packages/recorder/src/session.ts, packages/core/utils/sanitize.ts_
  - _Requirements: 2.3_
  - _Prompt: Role: Observability Engineer | Task: Build the telemetry adapter that records run/step lifecycle events, masks sensitive fields, and supports no-op injection per requirement 2.3 | Restrictions: Keep adapter optional/injectable, avoid HUD-specific imports beyond event interface, ensure telemetry flushes on completion or failure_
  - _Success: Telemetry emits start/attempt/success/failure events with masked data, HUD receives ordered updates, adapter gracefully handles absence of listeners_

- [x] 5. Add context scope helpers in `packages/workflows/src/engine/context.ts`
  - File: packages/workflows/src/engine/context.ts
  - Implement helpers for snapshot isolation, scoped mutations, TTL enforcement, and iteration-safe state handling used by `foreach`, `setContext`, and nested runs.
  - _Leverage: packages/context/src/store.ts, packages/workflows/src/types.ts_
  - _Requirements: 3.1_
  - _Prompt: Role: State Synchronization Engineer | Task: Build context helpers that provide scoped reads/writes with TTL handling and commit/rollback semantics per requirement 3.1 | Restrictions: Avoid direct GM_* usage (delegate to injected store), ensure snapshot copies remain serializable, cover nested scope merges_
  - _Success: Context helper exposes push/pop scope APIs, preserves isolation across branches, updates propagate via injected store, unit tests cover TTL and rollback cases_

- [x] 6. Wire executor into workflow registry in `packages/scripts/index.ts`
  - File: packages/scripts/index.ts (modify existing)
  - Instantiate the executor with resolver/context defaults, expose HUD commands, and ensure recorder exports align with new runtime hooks.
  - _Leverage: packages/scripts/index.ts, packages/workflows/src/index.ts, packages/menu/src/hud.ts_
  - _Requirements: 2.3, 3.1_
  - _Prompt: Role: Integration Engineer | Task: Integrate the executor into the page registry, connect telemetry to HUD, and expose run APIs per requirements 2.3 and 3.1 | Restrictions: Maintain existing module registration patterns, prevent circular dependencies, keep initialization idempotent_
  - _Success: Page modules register workflows that run through the new executor, HUD timeline updates in real time, recorder exports continue to function_

- [x] 7. Author unit tests for executor runtime and resolver bridge
  - Files: packages/workflows/src/__tests__/executor.runtime.test.ts, packages/workflows/src/__tests__/resolver.bridge.test.ts
  - Cover retry backoff, timeout enforcement, control flow branches, context scopes, and resolver miss payloads with mocked dependencies.
  - _Leverage: packages/workflows/src/engine/runtime.ts, packages/workflows/src/engine/resolver.ts, tests/helpers/domFixtures.ts_
  - _Requirements: 2.1, 2.2, 3.1_
  - _Prompt: Role: QA Automation Engineer | Task: Write unit tests that validate executor behavior, logical key handling, and context isolation per requirements 2.1–3.1 | Restrictions: Mock DOM interactions/action executors, ensure deterministic timing by stubbing wait utilities, cover success and failure paths_
  - _Success: Tests assert retry/backoff logic, resolver miss metadata, and context isolation; suite passes in CI_

- [x] 8. Create telemetry integration tests with HUD adapters
  - File: packages/workflows/src/__tests__/integration/executor-telemetry.test.ts
  - Simulate runs with mocked HUD adapters verifying event ordering, masking, and skipped-step handling when errors occur.
  - _Leverage: packages/workflows/src/telemetry/runtime.ts, packages/menu/src/hud.ts, tests/helpers/hudMock.ts_
  - _Requirements: 2.3_
  - _Prompt: Role: Frontend QA Automation Engineer | Task: Build integration tests that confirm telemetry→HUD flow, including failure and cancellation scenarios, per requirement 2.3 | Restrictions: Avoid real DOM rendering, mock time to assert durations, ensure adapter remains decoupled from HUD internals_
  - _Success: Tests confirm HUD receives ordered events with masked payloads, skipped steps emit correct status, and telemetry flushes on completion_
