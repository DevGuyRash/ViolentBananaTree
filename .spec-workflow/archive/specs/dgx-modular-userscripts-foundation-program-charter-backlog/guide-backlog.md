# DGX Modular Userscripts Foundation Backlog

## Delivery Framing
- Recorder-first capabilities lead sequencing; every stream highlights handoffs that keep recorded flows exportable without manual selector edits.
- Dependencies reference existing modules from steering docs (`core`, `workflows`, `menu`, `context`, `selectors`, `inspector`, `recorder`, `scripts`, `apps/userscripts`, `apps/wxt-extension`).
- Streams stay implementation-agnostic while signaling where cross-team collaboration or follow-up specs are required.

## Core
- **Resilient runtime guardrails**
  - Value: Keeps recorder-generated workflows stable by enforcing timeout caps, retries, and structured `[DGX]` logging across core utilities.
  - Dependencies: `workflows` execution loop for retry hooks; `scroll & collect` safeguards for termination metadata.
  - Recorder Priority: Guarantees recorded steps replay with predictable error handling and diagnostics.
- **Typed module boundaries hardening**
  - Value: Ensures `core` exports remain safe for AI contributors by tightening TypeScript surfaces and deprecating legacy helpers.
  - Dependencies: `docs` updates for contributor guidance; `build & tooling` lint/typecheck enforcement.
  - Recorder Priority: Keeps recorder exports strongly typed when writing selectors and DSL steps.

## Workflows
- **Step catalog completion**
  - Value: Adds recorder-aligned steps (conditional branches, foreach loops, masked typing) to make recorded flows runnable without manual edits.
  - Dependencies: `recorder` timeline schema for new step kinds; `selector system` for logical key coverage.
  - Recorder Priority: Eliminates gaps between recorded events and executable DSL steps.
- **Workflow validation harness**
  - Value: Provides dry-run validation with clear miss diagnostics before deployment, reducing brittle releases.
  - Dependencies: `core` logging APIs; `context store` for sandboxed variable resolution.
  - Recorder Priority: Confirms recorder exports pass acceptance bar before publishing.

## UI/HUD
- **Unified HUD command palette**
  - Value: Presents workflows, status, and recorder toggles in a single overlay so power users and agents share the same surface.
  - Dependencies: `menu` adapters for Tampermonkey/Violentmonkey parity; `context store` hooks for live state indicators.
  - Recorder Priority: Exposes recorder start/stop and replay from the same interface used during authoring.
- **Run-time diagnostics panel**
  - Value: Surfaces selector misses, scroll reasons, and masked field usage inline to speed triage.
  - Dependencies: `workflows` logging events; `scroll & collect` instrumentation; `recorder` masking status.
  - Recorder Priority: Highlights recorder-derived metadata so authors catch drift quickly.

## Selector System
- **Selector map schema evolution**
  - Value: Formalizes stability scoring, scope keys, and notes so inspector/recorder output remains standardized.
  - Dependencies: `recorder` export pipeline; `inspector` scoring insights; `docs` schema references.
  - Recorder Priority: Maintains compatibility between recorded selectors and runtime resolver.
- **Automated selector validation CLI**
  - Value: Adds linting for logical keys, duplicate strategies, and scoring thresholds to prevent brittle submissions.
  - Dependencies: `build & tooling` for CLI plumbing; `core` resolver contracts for validation rules.
  - Recorder Priority: Rejects recorder exports that would violate stability expectations.

## Inspector
- **Scoring rationale overlays**
  - Value: Shows why strategies receive stability scores, guiding authors toward semantic-first selectors.
  - Dependencies: `selector system` metadata; `ui/hud` overlay shell for consistent styling.
  - Recorder Priority: Drives better selector choices during recording sessions.
- **Scoped root guidance**
  - Value: Suggests logical scope keys when the inspector detects nested widgets, reducing future selector drift.
  - Dependencies: `core` DOM utilities; `context store` for remembering preferred scopes per page.
  - Recorder Priority: Captures precise structure so recorder exports stay resilient.

## Recorder
- **Timeline editor enhancements**
  - Value: Enables reordering, grouping, and annotating recorded steps before export to cut manual edits.
  - Dependencies: `workflows` DSL serialization; `ui/hud` for shared UX components.
  - Recorder Priority: Central to recorder-first promise—exports align with how authors expect flows to run.
- **Masked input enforcement**
  - Value: Adds preview and validation for masked fields, ensuring privacy defaults hold across exports.
  - Dependencies: `selector system` notes for sensitive fields; `context store` placeholders.
  - Recorder Priority: Keeps recorder outputs compliant with privacy constraints without extra review.

## Context Store
- **TTL and conflict policy dashboarding**
  - Value: Visualizes active keys, TTL timers, and conflict resolutions so teams trust cross-tab synchronization.
  - Dependencies: `ui/hud` diagnostics panel; `build & tooling` for local instrumentation toggles.
  - Recorder Priority: Recorder exports can depend on predictable context behaviors during playback.
- **Schema presets for workflows**
  - Value: Ships starter context schemas per workflow type (e.g., authentication tokens, filters) to speed authoring.
  - Dependencies: `docs` quick-start guides; `workflows` templating support.
  - Recorder Priority: Recorder can inject `${ctx:...}` placeholders without extra setup.

## Scroll & Collect
- **ScrollUntil safety nets**
  - Value: Adds default termination heuristics, logging, and recovery strategies to handle infinite lists.
  - Dependencies: `core` timing guards; `workflows` validation harness.
  - Recorder Priority: Recorded scroll actions remain safe to replay across sites.
- **CollectList mapping utilities**
  - Value: Provides configurable mapping/deduping pipelines for data harvest steps, reducing custom code.
  - Dependencies: `context store` for persisted collections; `selector system` for key discovery.
  - Recorder Priority: Recorder can export list collection flows that stay maintainable.

## Build & Tooling
- **Userscript + MV3 parity pipeline**
  - Value: Guarantees builds share TypeScript configuration, linting, and smoke tests, catching divergence early.
  - Dependencies: `apps/userscripts`, `apps/wxt-extension`; `core` logging for smoke checks.
  - Recorder Priority: Ensures recorder outputs behave identically in both targets.
- **Spec-driven CI checks**
  - Value: Adds spec compliance linting (tasks completion, selector schema validation, recorder masking) to enforce governance.
  - Dependencies: `selector system` CLI; `docs` acceptance bar; `tasks.md` automation hooks.
  - Recorder Priority: Protects recorder-first workflows from regressing in CI.

## Docs
- **Recorder-first quick start**
  - Value: Walks contributors through recording, exporting, and validating workflows without touching raw code.
  - Dependencies: `recorder` timeline enhancements; `workflows` validation harness.
  - Recorder Priority: Reinforces recorder as default authoring path.
- **Selector governance playbook**
  - Value: Documents scoring expectations, scope usage, and review checklist to keep logical keys consistent.
  - Dependencies: `selector system` schema evolution; `inspector` scoring overlays.
  - Recorder Priority: Aligns reviewers on maintaining recorder-generated selector quality.
