# Tasks Document

- [x] 1. Establish wait configuration contracts
  - File: packages/core/utils/wait/types.ts (new)
  - Define `WaitOptions`, `VisibilityOptions`, `IdleWindowOptions`, `WaitResult`, and `WaitError` interfaces with discriminated error codes
  - Export typed factories through `packages/core/utils/wait/index.ts`
  - Purpose: Provide strongly typed contracts for waits consumed by workflows, recorder, and HUD telemetry
  - _Leverage: packages/workflows/src/types.ts, packages/core/resolve.ts_
  - _Requirements: 1, 4, 5_
  - _Prompt: Role: TypeScript library engineer specializing in browser automation waits | Task: Create shared wait option/result/error interfaces aligned with requirements 1, 4, and 5, re-exporting through packages/core barrels | Restrictions: Adhere to existing naming conventions, avoid runtime logic, document discriminated union members via JSDoc | Success: Types compile without errors, consumers can import typed options/results, error codes mirror requirements_

- [x] 2. Implement WaitScheduler with resolver integration
  - File: packages/core/utils/wait/scheduler.ts (new)
  - Create scheduler class/functions orchestrating resolver attempts, timeout budgeting, polling loop, and jittered intervals
  - Inject resolver, clock, telemetry, and logger dependencies via constructor/factory pattern
  - Purpose: Provide central wait execution engine respecting selector strategy order, retries, and performance caps
  - _Leverage: packages/core/resolve.ts, packages/core/utils/time.ts_
  - _Requirements: 1, 4_
  - _Prompt: Role: Senior TypeScript engineer experienced in async orchestration | Task: Build WaitScheduler coordinating logical key resolution, polling, and timeout caps per requirements 1 and 4 | Restrictions: No setInterval leaks (use clearable handles), respect default ≤150ms polling and ≤8000ms timeouts, attach strategy history to results | Success: Scheduler resolves elements with metadata, obeys caps, emits structured telemetry hooks_

- [x] 3. Build predicate evaluation modules
  - File: packages/core/utils/wait/predicates/text.ts & visibility.ts (new)
  - Implement text, regex, contains, and visibility calculations consuming resolved nodes and producing predicate snapshots
  - Purpose: Encapsulate predicate logic reused by wait helpers and recorder diagnostics
  - _Leverage: packages/core/utils/dom.ts, packages/core/utils/sanitize.ts_
  - _Requirements: 2, 4_
  - _Prompt: Role: Frontend systems engineer focused on DOM diagnostics | Task: Create predicate evaluators for text and visibility states aligned with requirements 2 and 4 | Restrictions: Mask sensitive text via sanitizer, compute visibility using display/visibility/opacity/bounding box heuristics, return structured snapshots for logging | Success: Predicates report satisfied status accurately, snapshots feed telemetry, stale nodes handled gracefully_

- [x] 4. Implement mutation idle gate utilities
  - File: packages/core/utils/wait/idle-gate.ts (new)
  - Create shared MutationObserver wrapper enforcing idle windows with configurable idle duration and max window cutoffs
  - Purpose: Provide reusable idle detection for asynchronous rerenders and virtualized content
  - _Leverage: packages/core/utils/mutation.ts (if exists) or new helper under same directory_
  - _Requirements: 3, 5_
  - _Prompt: Role: Browser automation specialist proficient in MutationObserver patterns | Task: Implement idle gate meeting requirements 3 and 5, coordinating idleMs/maxWindowMs and telemetry heartbeat events | Restrictions: Disconnect observers after completion, record last mutation timestamp, respect performance budget | Success: Idle waits resolve when window satisfied, errors contain mutation statistics, integrates with scheduler_

- [x] 5. Expose wait helper API surface
  - File: packages/core/utils/wait/index.ts (update)
  - Export factory `createWaitHelpers(deps)` returning `waitFor`, `waitText`, `waitVisible`, `waitHidden`, `waitForIdle`
  - Purpose: Provide clear entrypoint for workflows and recorder modules with dependency injection hooks
  - _Leverage: scheduler.ts, predicates modules, idle gate_
  - _Requirements: 1, 2, 3_
  - _Prompt: Role: Library API designer with focus on developer ergonomics | Task: Assemble wait helper exports aligning with requirements 1-3, exposing typed signatures and dependency injection points | Restrictions: Avoid circular imports, surface debug hooks, ensure tree-shakeable structure | Success: Consumers import helpers from core index, helpers call scheduler/predicates correctly, type definitions accessible_

- [x] 6. Integrate waits into workflow engine executors
  - File: packages/workflows/src/actions/wait.ts (new or update existing)
  - Wire `waitFor`, `waitText`, `waitVisible`, `waitHidden`, and idle windows into workflow step executors with telemetry events
  - Purpose: Ensure workflows leverage new utilities while preserving existing action semantics
  - _Leverage: packages/workflows/src/engine.ts, packages/workflows/src/telemetry.ts_
  - _Requirements: 1, 2, 4_
  - _Prompt: Role: Workflow runtime engineer ensuring action parity | Task: Integrate new wait helpers into workflow executors following requirements 1, 2, and 4 | Restrictions: Maintain backward compatibility for existing steps, propagate structured errors to HUD, support debug logging toggles | Success: Workflow waits use new scheduler, telemetry shows progress, errors include metadata_

- [ ] 7. Coordinate waits with scroll/virtualization utilities
  - File: packages/core/utils/wait/integration-scroll.ts (new)
  - Provide helper to sync waits with scroller keys and presence thresholds for virtualized lists
  - Purpose: Prevent stale element detection and align waits with scrolling utilities when skeleton loaders or virtualization present
  - _Leverage: packages/core/utils/scroll.ts, scheduler.ts_
  - _Requirements: 5_
  - _Prompt: Role: Frontend performance engineer versed in virtualized DOM patterns | Task: Bridge wait helpers with scroll utilities per requirement 5 | Restrictions: Ensure integration optional, avoid redundant scrolling loops, expose configuration via WaitOptions.scrollerKey | Success: Waits coordinate with scroll helper to extend presence thresholds and recover from virtualization delays_

- [ ] 8. Emit `[DGX]` wait telemetry and error narratives
  - File: packages/core/utils/wait/telemetry.ts (new)
  - Implement telemetry adapter functions producing heartbeat logs, success/failure entries, and failure messages with guidance
  - Purpose: Standardize wait logging consumed by HUD, recorder, and console observers
  - _Leverage: packages/workflows/src/telemetry.ts, existing logging utilities_
  - _Requirements: 4_
  - _Prompt: Role: Observability-focused engineer specializing in telemetry schemas | Task: Emit wait lifecycle events and formatted errors per requirement 4 | Restrictions: Mask sensitive data, include strategy histories, align event names with `[DGX] wait:*` convention | Success: Logs appear in HUD timeline with elapsed/poll counts, failure narratives include actionable guidance_

- [ ] 9. Author comprehensive unit and integration tests
  - File: packages/core/utils/wait/__tests__/scheduler.test.ts (new) + fixtures
  - Validate resolver fallbacks, text/visibility predicates, idle windows, stale node recovery, and scroller integration scenarios
  - Purpose: Guarantee reliability across dynamic DOM edge cases before end-to-end coverage
  - _Leverage: jest/playwright config (existing), fake timers utilities_
  - _Requirements: 1, 2, 3, 4, 5_
  - _Prompt: Role: QA automation engineer experienced with DOM testing harnesses | Task: Create unit/integration tests covering requirements 1-5, including dynamic UI and stale node simulations | Restrictions: Use fake timers to control polling, simulate mutation bursts, assert telemetry payloads | Success: Tests assert edge cases, mutation idle windows, timeout enforcement, and logging content_

- [ ] 10. Update recorder export annotations for waits
  - File: packages/recorder/src/to-workflow.ts (update)
  - Ensure recorder inserts wait metadata (predicate type, idle window guidance, resolver key hints) and marks dynamic UI edge cases
  - Purpose: Provide implementers with context when reviewing exported waits and align docs-as-contract principle
  - _Leverage: packages/recorder/src/to-workflow.ts, wait types_
  - _Requirements: 2, 4, 5_
  - _Prompt: Role: Recorder tooling engineer focusing on authoring UX | Task: Enhance recorder exports per requirements 2, 4, and 5 so waits include metadata and guidance | Restrictions: Keep exports deterministic, avoid leaking sensitive text, honor sanitizer rules | Success: Recorder output includes wait annotations and suggestions, workflows compile with new wait types_
