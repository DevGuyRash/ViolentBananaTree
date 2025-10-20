## Introduction

This program charter and backlog define the DGX Modular Userscripts Foundation scope, capturing the recorder-first, selector-stable automation scaffold described in project_overview.md.

## Alignment with Product Vision

The charter reinforces the steering vision by prioritizing declarative workflows, resilient selectors, HUD-driven usability, and recorder-first authoring that make Tampermonkey and Violentmonkey automations fast to build and maintain.

## Requirements

### Requirement 1 — Charter

**User Story:** As a steering committee, I want a shared charter so that all contributors share the same vision, constraints, and success definition.

#### Acceptance Criteria

1. WHEN stakeholders review the charter THEN it SHALL articulate: vision, problem statement, goals, success criteria, non-goals, personas, primary constraints (userscript managers, GM grants, CSP, performance budgets), and high-level architecture roles (core engine, selectors, HUD, recorder, context, build targets).
2. IF risks such as selector brittleness or CSP limits arise THEN the charter SHALL list mitigations grounded in the steering docs (semantic selector priority, MV3 fallback, capped polling, masking sensitive input).
3. WHEN newcomers reference the charter glossary THEN it SHALL define canonical terms (selector map, workflow, HUD, context store, inspector, recorder).

### Requirement 2 — Feature Backlog & Milestones

**User Story:** As a program lead, I want an implementation-agnostic backlog grouped by capability streams so that teams can stage delivery toward MVP and post-MVP milestones.

#### Acceptance Criteria

1. WHEN the backlog is reviewed THEN it SHALL group features under Core, Workflows, UI/HUD, Selector System, Inspector, Recorder, Context Store, Scroll & Collect, Build & Tooling, and Docs streams with concise user-value framing.
2. WHEN milestones are communicated THEN the document SHALL provide MVP and Post-MVP checklists referencing backlog items and highlighting recorder-first and parity goals.
3. IF stakeholders need to gauge readiness THEN the milestones SHALL cite the project-wide acceptance bar and note open questions requiring decisions.

### Requirement 3 — Acceptance Bar & Open Questions

**User Story:** As a release manager, I want a consistent definition of done and a list of unresolved decisions so that teams know when features graduate from discovery to delivery.

#### Acceptance Criteria

1. WHEN contributors evaluate feature completion THEN the acceptance bar SHALL cover testing, selector stability verification, HUD recorder validation, Tampermonkey and Violentmonkey parity, and documentation handoff.
2. IF open questions block progress THEN the document SHALL enumerate them with owners or next-step signals (e.g., telemetry policy, selector schema evolution, MV3 parity requirements).
3. WHEN stakeholders resolve questions THEN they SHALL be able to trace back to the charter section that identified the dependency.

## Non-Functional Requirements

### Code Architecture and Modularity
- Preserve module boundaries described in steering docs (core, workflows, menu, context, selectors, inspector, recorder, scripts, build targets).
- Ensure backlog items reference these boundaries to keep responsibilities isolated and reusable.

### Performance
- Honor polling ≤150 ms and step timeouts ≤8 s when describing backlog items or acceptance criteria.
- Note HUD/recorder overlays must stay performant on complex pages and degrade gracefully.

### Security
- Respect CSP by defaulting to userscripts with GM grants and leaning on MV3 for restricted pages.
- Require masking of sensitive input during recording and redact logs in acceptance bar.

### Reliability
- Demand selector fallbacks, retries, and explicit failure logging in backlog items.
- Emphasize cross-tab context coherence through BroadcastChannel and GM listeners.

### Usability
- Keep recorder-first authoring central; backlog should surface HUD affordances, inspector guidance, and documentation clarity for AI agents and power users alike.

## Charter Details

- **Vision:** Ship a forkable, recorder-first automation foundation that reduces time-to-first-workflow to under 10 minutes while keeping selectors resilient across page drift.
- **Problem Statement:** Existing ad-hoc userscripts are brittle, undocumented, and slow to author; teams need a repeatable scaffold with strong selector discipline, context sharing, and approachable UX.
- **Personas:** Script authors building and editing page automations, AI agents extending the template via deterministic specs, and power users running workflows via HUD/native menus.
- **Goals:** Declarative DSL covering click/type/wait/scroll/collect, recorder-driven selector authoring with stability scoring, synchronized context store, HUD parity with native menus, dual userscript/MV3 builds, and docs that unlock AI/agent contributors.
- **Non-Goals:** No remote backend services, no desktop/RPA control, no remote code loading, no telemetry beyond local logging in MVP.
- **Primary Constraints:** Must run under Tampermonkey/Violentmonkey with GM grants, respect page CSP, stay within performance budgets (≤150 ms polling, ≤8 s timeouts), and remain client-only for privacy.
- **High-Level Architecture:** Userscript shell orchestrates page registry, workflows engine, HUD/menu, context store, selector maps, inspector, recorder, and optional MV3 wrapper drawing from shared TypeScript packages.
- **Success Criteria:** Time to create a new workflow ≤10 minutes, selector miss rate <5 % with clear logs, recorder export accuracy ≥95 %, userscript and MV3 parity validated by smoke tests, recorder privacy defaults enforced.
- **Risks & Mitigations:** Selector drift (semantic-first strategies, recorder notes), CSP blocks (MV3 fallback), infinite scroll loops (termination guards), PII leakage (masking/redaction utilities), overlay conflicts (namespaced CSS, quick toggle).
- **Glossary:** Selector map, workflow DSL, HUD, context store, inspector, recorder, logical key, scrollUntil, collectList.

## Feature Backlog by Stream

- **Core:** DOM resolver utilities with semantic-first strategy ordering; retry/backoff utilities; logging with `[DGX]` prefix and structured errors.
- **Workflows:** Declarative DSL covering click/type/select/wait/scroll/collect/assert/conditional/foreach steps with templating and retries; engine to execute workflows per page.
- **UI/HUD:** Floating command palette, status badges, last-run logs, recorder toggle, native GM menu parity, per-page options modal.
- **Selector System:** JSON schema with stability scoring, scoped selectors, inspector-generated notes, fallbacks order, tooling to validate uniqueness.
- **Inspector:** Overlay with tooltip metadata, keyboard navigation, stability scoring explanations, quick scope adjustments, safe teardown.
- **Recorder:** Event capture (click/type/select/scroll/key), masking flows, timeline editor, workflow export to selectors + page modules, immediate run validation.
- **Context Store:** GM storage adapters with TTL, BroadcastChannel sync, subscription API, conflict resolution policies, namespacing per page.
- **Scroll & Collect:** scrollIntoView helpers, scrollUntil termination detection, list collection helpers with dedupe/map options, instrumentation for scroll reasons.
- **Build & Tooling:** Vite + vite-plugin-monkey pipeline with aliases, WXT MV3 build parity, lint/typecheck scripts, smoke workflow harness.
- **Docs:** README, AGENTS, CONTRIBUTING, RECORDER references aligned with charter, including quick-start and troubleshooting for recorder-first authoring.

## Milestones

- **MVP Checklist:** Core resolver + DSL steps operational; selector map schema + inspector suggestions with stability scores; HUD + native menus exposing demo workflows; recorder captures click/type/select/scroll with masking; context store synchronizes across tabs; scrollUntil and collectList utilities guard against infinite loops; Vite userscript build and WXT parity smoke-tested; docs seeded for quickstart and recorder usage.
- **Post-MVP Checklist:** Recorder import/export bundles; plugin hooks for custom step kinds; MV3 side-panel UX; optional telemetry/analytics strategy; localization plan; selector auto-healing concepts; advanced assertions and on-fail recovery.

## Project-Wide Acceptance Bar

- Dual validation on Tampermonkey and Violentmonkey with GM grants confirmed.
- Selector stability verified via inspector uniqueness metrics and workflow smoke execution (≤5 % miss rate target).
- Recorder exports replay successfully without manual selector edits and preserve masking defaults.
- HUD and native menus stay in sync, displaying workflow status and logs.
- Context store retains values across refresh/tab boundaries with TTL behavior tested.
- Documentation (README/AGENTS/RECORDER) updated to reflect new capabilities and quick-start path.
- Optional MV3 build compiles from same packages without divergent code.

## Open Questions

- What telemetry (if any) is acceptable post-MVP for selector miss analytics while preserving privacy?
- How should selector map versioning and migration be handled when recorder evolves schema fields (e.g., scoring metadata)?
- What criteria trigger investment in auto-healing selectors versus manual JSON updates?

## Decisions & Resolutions

- **Additional step kinds (drag-and-drop, file upload):** Defer to post-MVP backlog; prioritize once recorder and DSL cover scroll/collect/assert parity and we have real site demand. Rationale: avoid scope creep before core recorder parity is validated.
- **Grants and CSP exceptions documentation:** Maintain a dedicated section in docs backlog to capture MV3-first deployment guidance for CSP-restricted targets, ensuring parity requirements are tracked alongside build tooling tasks.
