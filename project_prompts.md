## 1) Foundation Prompt (program charter & backlog)

Status: Done

```markdown
Using the spec-workflow droid, please accomplish the following:
**Prompt:**
**Title:** DGX Modular Userscripts Foundation — Program Charter & Backlog
Read `project_overview.md` and produce a concise **program charter** and **feature backlog** for the DGX project. Capture **vision**, **personas**, **goals**, **non‑goals**, **primary constraints** (userscript managers, grants, CSP, performance budgets), and **high‑level architecture**.
Deliver:

1. **Charter** (vision, problem, goals, success criteria, non‑goals, risks/mitigations, glossary).
2. **Backlog** grouped by streams (Core, Workflows, UI/HUD, Selector System, Inspector, Recorder, Context Store, Scroll & Collect, Build & Tooling, Docs).
3. **Milestones** for MVP and Post‑MVP with feature checklists.
4. **Project‑wide acceptance bar** (what “done” means across features).
5. **Open questions** requiring stakeholder decision.
   Use `project_overview.md` as the canonical reference and keep the output implementation‑agnostic.
```

---

## 2) General Feature Spec Prompt (template)

```markdown
Using the spec-workflow droid, please accomplish the following:
**Prompt (template):**
**Title:** DGX — Feature Spec: <FEATURE NAME>
Using `project_overview.md` (and the steering docs Product.md, Tech.md, Structure.md if present), create a **feature specification** for **<FEATURE NAME>** in the **<STREAM/MODULE>** area.
Include:

- **Problem & outcomes** this feature must achieve.
- **Scope** and **explicit non‑goals** for this feature.
- **Primary users & usage scenarios** (tie to personas).
- **Inputs/outputs** and **interactions** with existing modules.
- **Constraints & compliance**: TM/VM grants, CSP, storage, performance budgets, accessibility.
- **Dependencies** on other specs or modules.
- **Acceptance criteria** (clear, testable, aligned to project success metrics).
- **Edge cases & failure behaviors** (e.g., selector misses, timeouts, scroll end).
- **Telemetry/observability events** to emit (names & purposes).
- **Risks & mitigations**, **open questions**, **assumptions**.
Avoid implementation details; focus on **WHAT** the spec must cover and deliver.
```

```markdown
Using the spec-workflow droid, please accomplish the following:
**How to use:** Replace <FEATURE NAME> and <STREAM/MODULE>. Paste into your spec agent.
```

---

## 3) Ready‑to‑use Per‑Feature Prompts

Paste any of these as‑is; they already reflect your project’s language and constraints.

### 3.1 Core — Selector System & Resolver

Status: Done

```markdown
Using the spec-workflow droid, please accomplish the following:
**Title:** DGX — Feature Spec: Selector System & Resolver
Produce a spec for a **SelectorMap JSON** per site with logical keys and ordered strategies (role/name/label/text → data attr/test id → CSS → XPath), plus a resolver that tries in order and logs misses. Include scoping to containers, tags/notes, stability scoring, and graceful degradation. Define outcomes, scope, constraints, dependencies, acceptance criteria, edge cases, observability, risks, and open questions based on `project_overview.md`.
```

### 3.2 Core — Workflow Engine & DSL

Status: Done

```markdown
Using the spec-workflow droid, please accomplish the following:
**Title:** DGX — Feature Spec: Workflow Engine & DSL
Specify the declarative workflow model (step kinds like click, type, select, waits, conditionals, delay, setContext, assertions, foreach, logging, retry policy). Define how steps reference **logical keys** only, default timeouts/intervals, and error signaling. Include outcomes, scope, constraints, acceptance, and telemetry requirements as described in `project_overview.md`.
```

### 3.3 Utilities — Waiting & Loading

Status: In-Progress

```markdown
Using the spec-workflow droid, please accomplish the following:
**Title:** DGX — Feature Spec: Waiting & Loading Utilities
Define spec for waits (waitFor by key/CSS/XPath/text, waitText, wait for visibility, mutation/idle windows). Cover timeouts, polling caps, debug logs, and failure messaging. Include constraints, dependencies (resolver), acceptance criteria, and edge cases (dynamic UIs, stale nodes).
```

### 3.4 Utilities — Scrolling & “Scroll Until …”

```markdown
Using the spec-workflow droid, please accomplish the following:
**Title:** DGX — Feature Spec: Scroll Utilities & Scroll‑Until
Specify scroll container detection, scrollIntoView behaviors, and `scrollUntil` options (end, element, list growth, predicate; step size, caps, delays, timeout). Define “no‑change” termination logic, acceptance criteria, and failure logs. Include interactions with Recorder and Selector System.
```

### 3.5 Utilities — List Extraction

Status: Waiting

```markdown
Using the spec-workflow droid, please accomplish the following:
**Title:** DGX — Feature Spec: List Extraction
Specify `collectList` high‑level behavior: parent & item targeting by logical keys or CSS, output modes (text, HTML, attrs), dedupe options, limits, and optional mapping to structured objects. Include acceptance criteria for correctness and robustness.
```

### 3.6 UI — HUD & Native Menu

Status: Waiting

```markdown
Using the spec-workflow droid, please accomplish the following:
**Title:** DGX — Feature Spec: HUD + Native Menu
Describe the floating HUD/command palette plus mirrored Tampermonkey/Violentmonkey menu entries. Include page‑scoped commands, minimal settings modal, status indicators, hotkeys, and discoverability. Define constraints (CSP, styling via injected CSS), acceptance tests, and error states.
```

### 3.7 Data — Context Store (Cross‑Page/Tab)

Status: Waiting

```markdown
Using the spec-workflow droid, please accomplish the following:
**Title:** DGX — Feature Spec: Context Store
Define a shared state layer backed by GM storage and `BroadcastChannel` with get/set/delete/subscribe, optional TTL, and namespacing by page id. Include sync behavior across tabs, conflict handling, and acceptance criteria.
```

### 3.8 UX — Visual Inspector (Overlay + Picker)

Status: Waiting

```markdown
Using the spec-workflow droid, please accomplish the following:
**Title:** DGX — Feature Spec: Visual Inspector
Specify an element highlight overlay with tooltip showing tag/id/classes, role/name/label, text snippet, data‑attrs, and suggested selector strategies with stability scores and uniqueness checks. Include keyboard navigation (ancestors/siblings), scoping to container keys, and constraints (no eval, clean teardown). Define acceptance criteria and observability.
```

### 3.9 UX — Recorder (Action Timeline → DSL + Selectors)

Status: Waiting

```markdown
Using the spec-workflow droid, please accomplish the following:
**Title:** DGX — Feature Spec: Recorder
Define recording of clicks, hovers, focus/blur, typing/paste (with masking option), selects, toggles, keypresses, and scrolls. Require mapping to logical keys, primary strategy selection with fallbacks, and export into page module workflows and selector JSON. Include privacy defaults, scroll container capture, acceptance criteria, and failure behaviors.
```

### 3.10 Shell — Page Modules & Registry

Status: Waiting

```markdown
Using the spec-workflow droid, please accomplish the following:
**Title:** DGX — Feature Spec: Page Modules & Registry
Specify how a page module declares id/label/matches/selectors/workflows, and how the shell registers only active modules for the current URL. Include acceptance criteria for correct activation and command registration.
```

### 3.11 Build — Userscript (Vite + vite‑plugin‑monkey)

Status: Waiting

```markdown
Using the spec-workflow droid, please accomplish the following:
**Title:** DGX — Feature Spec: Userscript Build
Define the userscript build target, dev server install URL, live reload expectations, and path aliases for packages. Include acceptance criteria for TM/VM compatibility and grants presence.
```

### 3.12 Build — Optional MV3 Extension (WXT)

Status: Waiting

```markdown
Using the spec-workflow droid, please accomplish the following:
**Title:** DGX — Feature Spec: MV3 Extension (Optional)
Specify the MV3 build that composes the same content logic as the userscript. Define content script injection constraints, parity expectations, and acceptance criteria (no refactors required to share code).
```

### 3.13 Docs — Documentation Bundle

Status: Waiting

```markdown
Using the spec-workflow droid, please accomplish the following:
**Title:** DGX — Feature Spec: Documentation Deliverables
Scope the initial docs: README, AGENTS, CONTRIBUTING, RECORDER guide. Define what each must cover (install/build/run, adding pages/selectors, recorder use, troubleshooting), acceptance criteria for clarity and completeness.
```

### 3.14 Quality — Acceptance, Logging & Telemetry

Status: Waiting

```markdown
Using the spec-workflow droid, please accomplish the following:
**Title:** DGX — Feature Spec: Acceptance, Logging & Telemetry
Define project‑wide logging prefixing, event taxonomy (runs, step successes/failures, selector misses, timeouts), and acceptance checks per feature. Include minimal privacy‑respecting telemetry fields and opt‑out expectations.
```

### 3.15 Safety — Security, Privacy, Accessibility

Status: Waiting

```markdown
Using the spec-workflow droid, please accomplish the following:
**Title:** DGX — Feature Spec: Security, Privacy, Accessibility
Formalize CSP expectations, no‑eval constraints, input masking defaults, data retention (client‑side), and a11y preferences (role/name/label first). Include acceptance criteria and risks.
```

### 3.16 Performance — Budgets & Timeouts

Status: Waiting

```markdown
Using the spec-workflow droid, please accomplish the following:
**Title:** DGX — Feature Spec: Performance Budgets
Define polling intervals, default timeouts, and ceiling caps per operation. Include performance acceptance gates and debug behavior on budget breaches.
```

---

## 4) Additional Prompt Templates (change, bugs, docs)

### 4.1 Change Request / Enhancement

```markdown
Using the spec-workflow droid, please accomplish the following:
**Title:** DGX — Change Spec: <TITLE>
Produce a spec that explains the desired change, affected modules, rationale, scope and non‑goals, acceptance criteria, risks, and rollout impact. Reference `project_overview.md`.
```

### 4.2 Bug Fix

```markdown
Using the spec-workflow droid, please accomplish the following:
**Title:** DGX — Bug Spec: <SHORT SUMMARY>
Produce a spec that summarizes symptoms, expected vs actual outcomes, suspected area, reproduction preconditions, acceptance criteria for the fix, side‑effects to watch, and any selectors/workflows at risk. Reference `project_overview.md`.
```

### 4.3 Documentation Task

```markdown
Using the spec-workflow droid, please accomplish the following:
**Title:** DGX — Docs Spec: <DOC NAME>
Produce a scoped docs plan (audience, objectives, must‑cover topics, examples needed, acceptance criteria for clarity/completeness, and cross‑links). Reference `project_overview.md`.
```

---

## 5) Steering Docs (drop into repo root)

These steer the specs; they set boundaries and context without prescribing implementation.

### 5.1 Product.md

**Name**
DGX Modular Userscripts Foundation

**Summary**
A forkable, “Swiss Army Knife” scaffold for building robust, per‑page automation as userscripts, with an optional MV3 extension build. It emphasizes declarative workflows, strong selectors, cross‑tab state, a HUD + native menus, and a built‑in Inspector/Recorder for rapid authoring.

**Target Users**

- Script Authors creating site‑specific automations.
- AI Agents extending the repo by following schemas and docs.
- Power Users invoking workflows via HUD or native menu.

**Goals**

- Fast authoring: add a new page + workflow quickly.
- Reliability: degrade gracefully on selector changes with clear misses.
- Reuse & portability: one codebase for userscript + optional MV3.
- Recorder‑first authoring: capture interactions and export to specs.
- Docs an AI can follow to add pages/selectors/workflows.

**Non‑Goals (MVP)**
Remote code hosting, full desktop/RPA, backend services.

**Value Propositions**

- **Speed:** declarative DSL + recorder = rapid creation.
- **Stability:** semantic selectors and fallbacks.
- **Control:** explicit context store and per‑page menus.
- **Portability:** userscript and extension outputs.

**Personas & Key Journeys**

- **Author:** Creates a new page module, maps selectors, records a workflow, runs it from HUD.
- **AI Agent:** Reads Product/Tech/Structure + `project_overview.md`, proposes specs, ships demo pages.
- **Power User:** Configures options, runs workflows, sees clear logs and outcomes.

**Scope (MVP)**
Core DOM/Resolver, Workflow Engine, Wait/Scroll/Collect utilities, Context Store, HUD + native menu, Inspector, Recorder, Userscript build, Optional WXT build, Docs, Demo pages.

**Success Metrics (examples)**

- Time to first workflow ≤ 10 minutes (from blank module).
- Selector miss logs are explicit and actionable.
- Parity across TM/VM and optional MV3.
- Recorder exports valid selectors + steps without manual fix‑ups.

**Risks & Mitigations**

- Selector brittleness → semantic-first, fallbacks, scoring.
- CSP quirks → userscript injection + extension fallback.
- Infinite scroll → caps, timeouts, no‑change detection.
- Privacy leakage → masked inputs, redacted logs.

**Release Plan**

- **MVP:** core features + docs + demos.
- **Post‑MVP:** inspector improvements, workflow packs import/export, plugin hooks, telemetry ranking.

**References**
`project_overview.md`

---

### 5.2 Tech.md

**System Overview**

- Userscript shell with page registry activates only relevant modules.
- Selector System with logical keys and ordered strategies.
- Workflow Engine executing declarative steps against resolved elements.
- Utilities: wait, scroll, list extraction.
- Context Store: GM storage + BroadcastChannel with TTL and subscriptions.
- Menu Layer: HUD (command palette) + native TM/VM menu.
- Visual Inspector: overlay, suggestions, stability scoring.
- Recorder: action timeline → keys + steps → export.
- Build Targets: userscript (Vite + vite‑plugin‑monkey) and optional MV3 (WXT).

**Constraints**

- Managers: Tampermonkey, Violentmonkey.
- Grants: GM storage, style injection, menu APIs, value change listeners.
- Security: respect CSP; avoid unsafe eval.
- Performance: polling ≤ 150ms by default, timeouts ≤ 8s (configurable).
- Compatibility: Chrome, Firefox; userscript + MV3 parity.

**Cross‑Cutting Requirements**

- Logging prefix and clear error messages on misses/timeouts.
- Accessibility preference for role/name/label first.
- Privacy defaults: masked inputs in recorder; client‑only storage.

**Public Surface (names only, non‑exhaustive)**

- Core selectors & resolver (logical keys + strategy order).
- Workflow step kinds: click, type, select, waits, waitText, delay, setContext, conditionals, assertions, foreach, logging, keypress, hover, focus/blur, scrollIntoView, scrollUntil, collectList, capture.
- Utilities for waits, scrolling, list extraction.
- Context Store: get/set/delete/subscribe with TTL.
- HUD/menu registration.
- Inspector: pick/suggest; Recorder: session, mapping, export.

**Performance Budgets**

- Default intervals and timeouts as above; caps for scroll steps; defensive bails on no‑progress.

**Observability (WHAT to emit)**

- Workflow start/stop, step success/failure, selector strategy tried/used, miss events, timeouts, scroll termination reason, list counts, recorder export events.

**Acceptance Gates (project‑wide)**

- Meets constraints; clear logs; stable across TM/VM; recorded demo workflows pass; docs present and accurate.

**References**
`project_overview.md` and steering docs.

---

### 5.3 Structure.md

**Repository Layout (high level)**

- Root: package manifests, TypeScript config, license, Product/Tech/Structure docs, README/AGENTS/CONTRIBUTING/RECORDER.
- `packages/core`: DOM utils, waits, resolver, debug.
- `packages/context`: storage store and broadcast.
- `packages/menu`: HUD and native menu integration.
- `packages/workflows`: DSL types and engine.
- `packages/selectors`: per‑site selector maps.
- `packages/inspector`: overlay, picker, selector suggestions.
- `packages/recorder`: session, mapping, export.
- `packages/scripts`: page registry and page modules (site folders).
- `apps/userscripts`: Vite + vite‑plugin‑monkey userscript build.
- `apps/wxt-extension`: optional MV3 build (WXT).

**Documents & Specs Directory**

- `/specs`: one spec per feature/change/bug, named with a short id and title.
- Status lifecycle for specs: Draft → In Review → Approved → Implemented → Archived.
- Each spec declares: title, id, owners, approvers, scope, non‑goals, constraints, dependencies, acceptance criteria, risks, open questions, and links to related docs.

**Naming Conventions (WHAT to standardize)**

- Selector keys: lower_snake_case with concise, intention‑revealing names.
- Page module ids: site‑page slug (e.g., `oracle-edit`).
- Workflow ids: dashed, action‑oriented names (e.g., `fill-and-save`).
- Logging prefix: `[DGX]`.

**Quality Bars (per spec)**

- Clear inputs/outputs, acceptance criteria, and failure behaviors.
- Privacy and security checks documented.
- Performance budgets acknowledged.
- Observability events specified.

**Contribution Guidance (WHAT to provide)**

- Conventional commit scopes (`core`, `workflows`, `menu`, `selectors`, `inspector`, `recorder`, `docs`).
- PR checklist references applicable specs and acceptance criteria.
- Demos: at least one page with a runnable workflow that showcases the feature.

**References**
`project_overview.md`
