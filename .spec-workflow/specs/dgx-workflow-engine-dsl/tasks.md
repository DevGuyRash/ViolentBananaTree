# Tasks Document

- [x] 1. Define workflow DSL types and validators in `packages/workflows/src/types.ts`
  - File: packages/workflows/src/types.ts
  - Codify `Step`, `WorkflowDefinition`, `Condition`, `Assertion`, telemetry payloads, and runtime guards covering all step kinds (click, type, select, waitFor, waitText, delay, setContext, foreach, if, log, capture, collectList, scrollUntil, run, retry policy, etc.). Ensure logical key references are enforced via types and runtime assertions.
  - _Leverage: packages/workflows/src/index.ts, packages/recorder/src/to-workflow.ts_
  - _Requirements: 1.1, 1.2, 1.3_
  - _Prompt: Role: TypeScript Architect specializing in strongly typed DSLs | Task: Implement comprehensive workflow DSL types and runtime validators so recorder exports and manual authorship cover all required step kinds and logical key contracts specified in requirements 1.1–1.3 | Restrictions: Do not introduce new external dependencies, keep runtime guards tree-shakeable, align type names with existing recorder exports | _Leverage: packages/workflows/src/index.ts, packages/recorder/src/to-workflow.ts | _Requirements: 1.1, 1.2, 1.3 | Success: TypeScript types compile without errors, runtime guard rejects invalid step shapes, recorder output type-checks against the DSL_

- [x] 2. Implement workflow engine runner in `packages/workflows/src/engine.ts`
  - File: packages/workflows/src/engine.ts
  - Execute workflow steps sequentially with support for nested workflows, retries, default timeouts/intervals, context injection, and telemetry emission. Integrate resolver and context store through dependency injection.
  - _Leverage: packages/core/src/utils/wait.ts, packages/core/src/resolve.ts, packages/context/src/store.ts, packages/workflows/src/config.ts_
  - _Requirements: 2.1, 2.2, 2.3, 3.1_
  - _Prompt: Role: Workflow Runtime Engineer with expertise in asynchronous orchestration | Task: Build the workflow engine executor honoring default intervals/timeouts, retry policies, conditionals, foreach loops, and nested workflow calls per requirements 2.1–3.1, wiring telemetry hooks and logical key resolution | Restrictions: Maintain single responsibility per helper, do not access DOM utilities directly (delegate to action executors), ensure all errors propagate as structured `StepError` objects | _Leverage: packages/core/src/utils/wait.ts, packages/core/src/resolve.ts, packages/context/src/store.ts, packages/workflows/src/config.ts | _Requirements: 2.1, 2.2, 2.3, 3.1 | Success: Engine runs provided workflows end-to-end, applies defaults when unspecified, retries obey exponential backoff, telemetry emits correct lifecycle events_

- [x] 3. Create action executors in `packages/workflows/src/actions/*.ts`
  - Files: packages/workflows/src/actions/click.ts, type.ts, select.ts, waitFor.ts, waitText.ts, delay.ts, log.ts, setContext.ts, capture.ts, assert.ts, foreach.ts, run.ts, scrollUntil.ts, collectList.ts, hover.ts, focus.ts, blur.ts, retry.ts
  - Implement discrete executors that resolve logical keys, call core utilities, enforce sanitization (capture/log), and return structured results for telemetry. Share base helper for timeout handling.
  - _Leverage: packages/core/src/utils/dom.ts, packages/core/src/utils/scroll.ts, packages/core/src/utils/collect.ts, packages/core/src/resolve.ts, packages/context/src/store.ts, packages/workflows/src/types.ts_
  - _Requirements: 1.1, 2.1, 2.3, 4.1_
  - _Prompt: Role: Frontend Automation Engineer specializing in DOM interaction utilities | Task: Implement per-step action executors mapping DSL definitions to DOM operations, ensuring logical key usage, sanitizer integration, and telemetry-friendly responses per requirements 1.1, 2.1, 2.3, 4.1 | Restrictions: Keep each file under 200 lines, reuse shared helpers for resolving keys and handling timeouts, do not log sensitive data directly | Success: Executors perform expected DOM actions, mask sensitive captures, integrate with resolver/context, and return `StepResult` objects consumed by the engine_

- [x] 4. Add telemetry adapter in `packages/workflows/src/telemetry.ts`
  - File: packages/workflows/src/telemetry.ts
  - Provide APIs to record step lifecycle events, format `[DGX]` console output, stream updates to HUD, and buffer metadata for recorder playback.
  - _Leverage: packages/menu/src/hud.ts, packages/recorder/src/session.ts, packages/core/src/utils/sanitize.ts_
  - _Requirements: 4.1, 4.2, 4.3_
  - _Prompt: Role: Observability Engineer focused on client-side telemetry | Task: Implement telemetry adapter capturing workflow start/attempt/success/failure events with masked payloads and forwarding them to HUD and recorder per requirements 4.1–4.3 | Restrictions: Use existing sanitize utilities for sensitive data, ensure adapter is optional/injectable, avoid tight coupling to HUD internals | Success: Telemetry logs appear with `[DGX]` prefix, HUD receives structured updates, recorder can replay events for auditing_

- [ ] 5. Establish workflow registry hooks in `packages/scripts/index.ts`
  - File: packages/scripts/index.ts (modify existing)
  - Register workflow engine factory, inject shared defaults, and expose telemetry hooks to HUD/recorder. Ensure page modules declare workflow metadata consistent with the new DSL.
  - _Leverage: packages/scripts/index.ts, packages/workflows/src/index.ts, packages/menu/src/hud.ts_
  - _Requirements: 5.1, 5.2_
  - _Prompt: Role: Integration Engineer bridging runtime modules | Task: Update script shell to instantiate workflow engine with resolver, context store, telemetry per requirements 5.1–5.2, expose commands to HUD, and ensure recorder exports attach defaults | Restrictions: Preserve existing module registration patterns, do not introduce circular dependencies, keep initialization idempotent | Success: HUD lists workflows from page modules, runs invoke the new engine, telemetry is visible, recorder exports remain compatible_

- [ ] 6. Author unit tests for DSL and engine
  - Files: packages/workflows/src/__tests__/types.test.ts, engine.test.ts, actions/*.test.ts
  - Add Jest/ts-jest tests verifying type guards, engine retry behavior, conditional branching, foreach loops, and telemetry payloads.
  - _Leverage: packages/workflows/src/types.ts, packages/workflows/src/engine.ts, tests/helpers/domFixtures.ts_
  - _Requirements: 2.1, 2.2, 3.1, 4.1_
  - _Prompt: Role: QA Engineer specializing in TypeScript testing | Task: Write focused unit tests covering DSL validation, engine behavior, and representative action executors per requirements 2.1–4.1 | Restrictions: Use existing test harness utilities, avoid full DOM reliance where mocks suffice, ensure deterministic timing by mocking wait utilities | Success: Tests cover key control flow scenarios, guard against regressions, and pass in CI_

- [ ] 7. Create integration smoke tests for HUD timeline updates
  - File: packages/workflows/src/__tests__/integration/hud-telemetry.test.ts
  - Simulate workflow runs with mocked HUD adapter verifying timeline entries, masking, and status transitions.
  - _Leverage: packages/menu/src/hud.ts, packages/workflows/src/telemetry.ts, tests/helpers/hudMock.ts_
  - _Requirements: 4.1, 4.2_
  - _Prompt: Role: Frontend QA Automation Engineer | Task: Build integration tests validating telemetry->HUD flow per requirements 4.1–4.2 using mocked HUD adapters | Restrictions: Avoid real DOM rendering, ensure telemetry adapter remains decoupled, mock time to assert durations | Success: Tests confirm HUD receives correct events, statuses, and masked values_

- [ ] 8. Document developer entry points via inline JSDoc
  - Files: packages/workflows/src/index.ts, engine.ts, telemetry.ts
  - Add concise JSDoc explaining engine configuration, telemetry hooks, and DSL usage for AI contributors.
  - _Leverage: AGENTS.md, existing JSDoc style_
  - _Requirements: 1.1, 5.1_
  - _Prompt: Role: Developer Experience Engineer | Task: Provide inline JSDoc guidance describing workflow engine usage in alignment with requirements 1.1 and 5.1 | Restrictions: Keep comments succinct, avoid duplicating README content, follow existing JSDoc conventions | Success: Key exports feature clear documentation aiding AI agents and maintainers_
