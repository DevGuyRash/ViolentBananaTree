# Tasks Document

- [x] 1. Implement scroll container detection heuristics
  - File: packages/core/utils/scroll/container.ts (new)
  - Build detection helpers that inspect ancestor overflow, DGX hint attributes, and workflow context fallbacks; return strategy metadata for telemetry.
  - Purpose: Satisfy automatic container detection with clear diagnostics.
  - _Leverage: packages/core/resolve.ts, packages/core/utils/dom.ts_
  - _Requirements: 1, 6_
  - _Prompt: Role: Senior TypeScript engineer specializing in DOM heuristics | Task: Implement container detection honoring DGX hints, ancestor overflow, and document fallbacks with telemetry instrumentation | Restrictions: Avoid direct window globals in tests, expose pure functions for unit coverage | Success: Detector returns container element, strategy history, and logs diagnostics when fallbacks occur_

- [x] 2. Add safe `scrollIntoView` controller
  - File: packages/core/utils/scroll/into-view.ts (new)
  - Calculate alignment offsets, apply safety insets for sticky headers, and verify viewport visibility before resolving.
  - Purpose: Provide consistent `scrollIntoView` behavior with overscroll protection.
  - _Leverage: packages/core/utils/scroll/container.ts, packages/core/utils/math.ts_
  - _Requirements: 2, 5_
  - _Prompt: Role: Frontend systems engineer focused on scroll ergonomics | Task: Build into-view helper handling alignment options, safety margins, and bounded retries | Restrictions: Use requestAnimationFrame for smoothness, clamp offsets within container ranges | Success: Elements land fully within viewport, retries capped, telemetry logs adjustments_

- [x] 3. Build `scrollUntil` orchestrator core
  - File: packages/core/utils/scroll/until.ts (new)
  - Implement loop managing attempts, timeouts, inter-step delays, and delta tracking across modes.
  - Purpose: Centralize iterative scroll logic with deterministic termination.
  - _Leverage: packages/core/utils/scroll/container.ts, packages/core/utils/time.ts, packages/core/utils/wait/budget.ts_
  - _Requirements: 3, 4, 5_
  - _Prompt: Role: Async orchestration specialist | Task: Develop scrollUntil engine that merges defaults, enforces budgets, and routes mode-specific predicates | Restrictions: No unbounded loops, respect ≤500px steps and ≤1000ms delays, expose structured results | Success: Engine handles success, timeout, and no-change status with accurate telemetry_

- [x] 4. Implement mode predicate registry and list growth observers
  - File: packages/core/utils/scroll/predicates.ts (new)
  - Provide predicates for `end`, `element`, `list_growth`, and `predicate`, integrating selector resolver and mutation observers.
  - Purpose: Modularize stopping logic and support recorder-injected predicates.
  - _Leverage: packages/core/resolve.ts, packages/core/utils/mutation.ts_
  - _Requirements: 3, 5_
  - _Prompt: Role: Browser automation engineer with mutation observer expertise | Task: Create predicate registry covering all modes, including DOM stability measurement | Restrictions: Sanitize predicate errors, reuse mutation idle gate for list growth, expose typed outcomes | Success: Predicates report satisfied states, provide history snapshots, and clean up observers_

- [x] 5. Emit `[DGX]` scroll telemetry events
  - File: packages/core/utils/scroll/telemetry.ts (new)
  - Format lifecycle events (`start`, `attempt`, `success`, `failure`, `no_change`) with sanitized payloads and severity mapping.
  - Purpose: Deliver observable scroll diagnostics to HUD and recorder timelines.
  - _Leverage: packages/workflows/src/telemetry.ts, packages/core/utils/sanitize.ts_
  - _Requirements: 6_
  - _Prompt: Role: Observability-focused engineer | Task: Implement telemetry adapter aligning with existing wait events and masking sensitive fields | Restrictions: Use consistent event names (`[DGX] scroll:*`), avoid leaking raw selector text | Success: Logs render in HUD timeline with run identifiers and sanitized metadata_

- [x] 6. Integrate scroll helpers with workflow engine
  - File: packages/workflows/src/actions/scroll.ts (new) + packages/workflows/src/engine.ts (update)
  - Wire `scrollIntoView` and `scrollUntil` actions, honoring workflow configuration defaults and propagating structured errors.
  - Purpose: Expose scroll utilities to declarative workflows.
  - _Leverage: packages/workflows/src/actions/shared.ts, packages/core/utils/scroll_
  - _Requirements: 2, 3, 4, 5, 6_
  - _Prompt: Role: Workflow runtime engineer | Task: Register scroll actions, map DSL options to helper contracts, and forward telemetry to HUD | Restrictions: Maintain backward compatibility for existing scroll steps, ensure errors bubble with reason codes | Success: Workflows execute scroll steps deterministically with telemetry mirrored in HUD_
  - Notes: Scroll action handlers now resolve containers, map DSL options to helpers, sanitize telemetry, and surface structured StepErrors; regression suite `npm run test` passes.

- [ ] 7. Extend recorder capture and export metadata
  - File: packages/recorder/src/session.ts (update), packages/recorder/src/to-workflow.ts (update)
  - Capture heuristic container results, modes, and tuning parameters; emit annotations in exported workflows.
  - Purpose: Preserve scroll context for playback and AI agents.
  - _Leverage: packages/recorder/src/annotations.ts, packages/core/utils/scroll/recording.ts_
  - _Requirements: 6, 7_
  - _Prompt: Role: Recorder tooling engineer | Task: Inject scroll metadata into capture session and workflow export, providing hooks for predicate replay | Restrictions: Mask sensitive selectors, ensure deterministic serialization, keep bundle size minimal | Success: Recorder exports include scroll annotations and rehydrate options during replay_

- [ ] 8. Create recorder bridge helpers
  - File: packages/core/utils/scroll/recording.ts (new)
  - Provide APIs for recorder to register capture hooks, hydrate replay predicates, and format annotations.
  - Purpose: Decouple recorder integration from core orchestrators.
  - _Leverage: packages/recorder/src/context.ts, packages/core/utils/scroll/until.ts_
  - _Requirements: 7_
  - _Prompt: Role: Integration engineer bridging recorder and core utilities | Task: Build bridge module translating recorder context into scrollUntil options and predicate injections | Restrictions: Avoid circular deps, expose pure helpers for testing | Success: Recorder can inject predicates and container hints without touching orchestrator internals_

- [ ] 9. Author automated acceptance tests across targets
  - File: packages/tests/scroll/dgx-scroll-until.spec.ts (new) + e2e fixtures
  - Cover success and failure flows for each mode, sticky header scenarios, and telemetry assertions under Tampermonkey and MV3 builds.
  - Purpose: Validate end-to-end behavior and parity.
  - _Leverage: tests/helpers/playwright.ts, apps/userscripts/dev-pages_
  - _Requirements: 2, 3, 5, 6, 8_
  - _Prompt: Role: QA automation engineer | Task: Implement cross-target tests verifying scroll heuristics, termination reasons, and telemetry outputs | Restrictions: Use existing fixtures, keep runtime under CI budgets, collect HUD snapshots for documentation | Success: Tests pass on both targets, assert telemetry structure, and capture no-change handling_
