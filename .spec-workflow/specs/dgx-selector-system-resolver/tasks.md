- [x] 1. Establish selector schema contracts
  - Files: `packages/selectors/types.ts`, `packages/selectors/schema.ts`
  - Define TypeScript types for `SelectorMap`, `SelectorEntry`, `SelectorStrategy`, and runtime validation helpers enforcing ordered strategies and scoped roots.
  - Purpose: Provide a canonical schema so recorder exports and resolver consumers share a stable contract.
  - _Leverage: `packages/core/utils/dom.ts`, `packages/selectors/oracle.json`, `packages/recorder/to-workflow.ts`_
  - _Requirements: Requirement 1_
  - _Prompt: Implement the task for spec dgx-selector-system-resolver, first run spec-workflow-guide to get the workflow guide then implement the task: Role: TypeScript Schema Engineer specializing in runtime validation | Task: Define selector schema types and validation helpers ensuring ordered strategies (role/name/label/text → data attr/test id → CSS → XPath) with optional scopeKey support, updating `packages/selectors/types.ts` and creating `packages/selectors/schema.ts` per Requirement 1 | Restrictions: Do not introduce new third-party dependencies unless already in the repo, keep JSON parsing isolated, preserve existing selector map compatibility | _Leverage: `packages/core/utils/dom.ts`, `packages/selectors/oracle.json`, `packages/recorder/to-workflow.ts` | _Requirements: Requirement 1 | Success: Types compile without errors, validation rejects out-of-order strategies, schema loader exports typed helpers reusable by recorder and runtime | Instructions: Before coding set this task to [-] in tasks.md, and when finished set it to [x]._

- [x] 2. Implement resolver core orchestration
  - Files: `packages/core/resolve.ts`, `packages/core/index.ts`
  - Extend resolver to iterate strategies in priority order, respect scoped containers, and return structured results including attempts and resolved strategy metadata.
  - Purpose: Enable workflows to locate DOM elements deterministically and record which strategy succeeded.
  - _Leverage: `packages/core/utils/dom.ts`, `packages/workflows/engine.ts`, `packages/core/debug.ts`_
  - _Requirements: Requirement 2, Requirement 4_
  - _Prompt: Implement the task for spec dgx-selector-system-resolver, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Browser Automation Engineer with expertise in DOM resolution | Task: Enhance `packages/core/resolve.ts` to consume SelectorMap entries, iterate strategies in order with scoped container support, and return structured results consumed by the workflow engine per Requirements 2 and 4 | Restrictions: Avoid duplicating DOM helpers, keep resolver side-effect free outside logging hooks, do not break existing exports from `packages/core/index.ts` | _Leverage: `packages/core/utils/dom.ts`, `packages/workflows/engine.ts`, `packages/core/debug.ts` | _Requirements: Requirement 2, Requirement 4 | Success: Resolver passes unit tests, logs resolve attempts, respects scopeKey fallback rules, and integrates with workflow engine without regressions | Instructions: Before coding set this task to [-] in tasks.md, and when finished set it to [x]._

- [x] 3. Add resolver telemetry hooks
  - Files: `packages/core/resolve-telemetry.ts`, `packages/core/debug.ts`, `packages/menu/hud.ts`
  - Create telemetry helpers emitting success/miss data, stability scores, and tags for HUD/log consumption.
  - Purpose: Surface selector miss diagnostics and stability signals to observability layers.
  - _Leverage: `packages/core/debug.ts`, `packages/menu/hud.ts`, `packages/workflows/engine.ts`_
  - _Requirements: Requirement 2, Requirement 3, Requirement 4_
  - _Prompt: Implement the task for spec dgx-selector-system-resolver, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Observability-focused JavaScript Engineer | Task: Introduce resolver telemetry utilities that log attempts, successes, and misses with stability metadata, wiring into HUD notifications per Requirements 2–4 | Restrictions: Use existing `[DGX]` logging conventions, ensure sensitive data is sanitized, avoid coupling HUD UI to resolver internals | _Leverage: `packages/core/debug.ts`, `packages/menu/hud.ts`, `packages/workflows/engine.ts` | _Requirements: Requirement 2, Requirement 3, Requirement 4 | Success: Telemetry helpers export typed interfaces, workflow engine receives callbacks for logging, HUD displays miss information without performance regressions | Instructions: Before coding set this task to [-] in tasks.md, and when finished set it to [x]._

- [x] 4. Enhance recorder selector merge pipeline
  - Files: `packages/recorder/selector-merge.ts`, `packages/recorder/to-workflow.ts`, `packages/recorder/session.ts`
  - Implement merge logic that preserves existing selector metadata while appending new strategies, scores, tags, and notes.
  - Purpose: Ensure recorder exports stay in sync with manual edits and capture stability diagnostics.
  - _Leverage: `packages/selectors/types.ts`, `packages/recorder/selector-suggest.ts`, `packages/selectors/schema.ts`_
  - _Requirements: Requirement 1, Requirement 3_
  - _Prompt: Implement the task for spec dgx-selector-system-resolver, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Recorder Pipeline Engineer | Task: Build selector merge utilities that combine recorder suggestions with existing SelectorMap entries, preserving metadata order and updating scores per Requirements 1 and 3 | Restrictions: Do not mutate inputs in place; return new objects for recorder saves, maintain backward compatibility with existing exports | _Leverage: `packages/selectors/types.ts`, `packages/recorder/selector-suggest.ts`, `packages/selectors/schema.ts` | _Requirements: Requirement 1, Requirement 3 | Success: Recorder exports include stability scores, tags, and notes, duplicate strategies are deduplicated by type/value, and manual metadata remains intact | Instructions: Before coding set this task to [-] in tasks.md, and when finished set it to [x]._

- [x] 5. Update inspector and HUD displays for stability data
  - Files: `packages/inspector/overlay.ts`, `packages/menu/hud.ts`, `packages/menu/index.ts`
  - Surface stability scores, tags, and notes in inspector tooltips and HUD miss notifications, including graceful degradation messaging when strategies fail.
  - Purpose: Provide actionable feedback to authors when selectors degrade or miss targets.
  - _Leverage: `packages/recorder/selector-suggest.ts`, `packages/core/resolve-telemetry.ts`, `packages/menu/hud.ts`_
  - _Requirements: Requirement 3, Requirement 4_
  - _Prompt: Implement the task for spec dgx-selector-system-resolver, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Frontend Engineer focused on UX diagnostics | Task: Enhance inspector overlays and HUD notifications to display stability scores, tags, and graceful degradation messaging sourced from resolver telemetry per Requirements 3 and 4 | Restrictions: Keep overlay performance responsive, reuse existing HUD styling conventions, ensure masked data remains redacted | _Leverage: `packages/recorder/selector-suggest.ts`, `packages/core/resolve-telemetry.ts`, `packages/menu/hud.ts` | _Requirements: Requirement 3, Requirement 4 | Success: Tooltip/HUD updates render without layout issues, data matches resolver output, and miss events clearly indicate diagnostics | Instructions: Before coding set this task to [-] in tasks.md, and when finished set it to [x]._

- [ ] 6. Integrate resolver with workflow engine retries
  - Files: `packages/workflows/engine.ts`, `packages/workflows/types.ts`, `packages/core/resolve.ts`
  - Wire resolver results into step execution, logging miss events, and respecting retry/backoff policies without losing context.
  - Purpose: Ensure workflows degrade gracefully and expose selector failures as actionable errors.
  - _Leverage: `packages/workflows/engine.ts`, `packages/core/resolve-telemetry.ts`, `packages/core/utils/wait.ts`_
  - _Requirements: Requirement 2, Requirement 4_
  - _Prompt: Implement the task for spec dgx-selector-system-resolver, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Workflow Runtime Engineer | Task: Update workflow engine execution path to consume resolver results, emit miss telemetry, and honor retry/backoff policies while preserving context data per Requirements 2 and 4 | Restrictions: Maintain existing step API signatures, ensure backward compatibility with existing workflows, avoid increasing default timeout intervals | _Leverage: `packages/workflows/engine.ts`, `packages/core/resolve-telemetry.ts`, `packages/core/utils/wait.ts` | _Requirements: Requirement 2, Requirement 4 | Success: Workflow steps log resolved strategy, retries trigger correctly, miss events do not wipe context state, and unit/integration tests cover success/miss scenarios | Instructions: Before coding set this task to [-] in tasks.md, and when finished set it to [x]._

- [ ] 7. Create unit and integration tests for schema and resolver
  - Files: `packages/selectors/__tests__/schema.test.ts`, `packages/core/__tests__/resolve.test.ts`, `packages/workflows/__tests__/engine-resolver.integration.test.ts`
  - Author tests covering schema validation edge cases, resolver success/miss paths, and workflow integration with retries.
  - Purpose: Guard against regressions in selector resolution and telemetry behavior.
  - _Leverage: `packages/selectors/schema.ts`, `packages/core/resolve.ts`, `packages/workflows/engine.ts`, existing test harness utilities_
  - _Requirements: Requirement 1, Requirement 2, Requirement 4_
  - _Prompt: Implement the task for spec dgx-selector-system-resolver, first run spec-workflow-guide to get the workflow guide then implement the task: Role: QA Automation Engineer for TypeScript projects | Task: Write unit and integration tests covering schema validation, resolver success/miss flows, and workflow retry integration per Requirements 1, 2, and 4 | Restrictions: Use existing testing frameworks configured in the repo, avoid brittle DOM mocks, ensure tests run deterministically in CI | _Leverage: `packages/selectors/schema.ts`, `packages/core/resolve.ts`, `packages/workflows/engine.ts` | _Requirements: Requirement 1, Requirement 2, Requirement 4 | Success: Tests fail on schema order violations, detect resolver logging regressions, and confirm workflow retries respect resolver output | Instructions: Before coding set this task to [-] in tasks.md, and when finished set it to [x]._

- [ ] 8. Document selector map usage in recorder onboarding flow
  - Files: `packages/recorder/onboarding.ts`, `packages/recorder/session.ts`
  - Update in-recorder guidance/tooltips to explain stability scores, scope keys, and graceful degradation behavior without modifying external docs.
  - Purpose: Teach authors how to interpret the new selector metadata while staying within product UX.
  - _Leverage: `packages/recorder/selector-suggest.ts`, `packages/menu/hud.ts`, `packages/selectors/types.ts`_
  - _Requirements: Requirement 3_
  - _Prompt: Implement the task for spec dgx-selector-system-resolver, first run spec-workflow-guide to get the workflow guide then implement the task: Role: UX-focused Recorder Developer | Task: Enhance recorder onboarding overlays/tooltips to describe stability scores, scope keys, and graceful degradation messaging per Requirement 3 without touching external markdown docs | Restrictions: Do not edit README or docs files, keep copy concise, support localization scaffolding if present | _Leverage: `packages/recorder/selector-suggest.ts`, `packages/menu/hud.ts`, `packages/selectors/types.ts` | _Requirements: Requirement 3 | Success: Recorder onboarding displays updated messaging, HUD/inspector share consistent terminology, and no markdown docs are modified | Instructions: Before coding set this task to [-] in tasks.md, and when finished set it to [x]._
