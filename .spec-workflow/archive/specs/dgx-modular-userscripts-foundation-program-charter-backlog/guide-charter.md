# DGX Modular Userscripts Foundation Charter

## Vision
Deliver a recorder-first automation foundation that lets teams and AI agents compose resilient Tampermonkey and Violentmonkey workflows in minutes, pairing declarative DSL steps with stability-scored selector maps, synchronized context, and HUD-driven execution backed by an optional MV3 build.

## Problem Statement
Teams rely on ad-hoc userscripts that are brittle, undocumented, and slow to extend; they lack disciplined selector strategies, cross-tab state, and approachable tooling for recording and replaying workflows, making upkeep costly whenever target pages drift.

## Goals
- Provide a declarative workflow engine covering click, type, wait, scroll, collect, conditionals, and assertions so automation intent stays observable and testable.
- Ship inspector-guided selector authoring with stability scoring and scoped fallbacks that keep workflows durable as pages evolve.
- Offer HUD and native userscript menus with parity so power users can trigger workflows, monitor status, and toggle the recorder in one place.
- Maintain a context store using GM storage plus BroadcastChannel sync that preserves state across tabs while honoring TTL expectations.
- Ensure recorder exports selectors and workflow steps with masking by default, reducing time-to-first-workflow to under ten minutes.
- Keep userscript and MV3 builds in lockstep through shared TypeScript packages and Vite/WXT pipelines.

## Success Metrics
- Time to author a new page workflow: ≤10 minutes using inspector and recorder handoff.
- Selector miss rate during workflow runs: <5% with logged `[DGX]` diagnostics referencing attempted strategies.
- Recorder export accuracy: ≥95% of recorded flows require no manual selector edits before execution.
- Cross-target parity: Tampermonkey, Violentmonkey, and MV3 smoke workflows pass with identical behavior.
- Privacy adherence: 100% of masked recorder inputs remain redacted in stored selectors, workflows, and logs.

## Non-Goals
- Introducing remote services, telemetry backends, or cloud storage for workflows or context data.
- Extending automation beyond the browser (no desktop or native app control).
- Implementing dynamic code loading or remote script chunk delivery.
- Building full analytics dashboards beyond HUD status badges and logs.
- Delivering auto-healing selectors or plugin ecosystems in the initial charter scope.

## Personas
- **Script Author:** Needs a predictable scaffold and recorder workflow to add or adjust page-specific automations without digging into low-level DOM APIs.
- **AI Agent Contributor:** Follows specs, selector schemas, and charter terminology to extend modules autonomously while respecting module boundaries.
- **Power User:** Runs workflows via HUD or native menus, expects transparent logs, quick toggles, and safe masking of sensitive inputs.

## Constraints
- Must operate within Tampermonkey and Violentmonkey managers using granted GM APIs for storage, menus, and style injection.
- Page CSP restrictions require client-only script injection; MV3 packaging is the sanctioned fallback when userscript injection is blocked.
- Performance budgets cap polling intervals at ≤150 ms and workflow timeouts at ≤8 s to avoid page jank.
- All logic remains client-side with no remote telemetry; privacy-sensitive data stays masked end-to-end.
- Codebase adheres to prescribed package boundaries (core, workflows, menu, context, selectors, inspector, recorder, scripts, build targets) and TypeScript strictness.
- Selector keys and workflow identifiers follow existing naming conventions (snake_case keys, dashed workflow ids, `[DGX]` log prefix).

## High-Level Architecture
The userscript shell loads page modules from `packages/scripts`, resolves logical keys via the core resolver, and orchestrates workflows through the declarative engine. HUD components and Tampermonkey/Violentmonkey menu adapters expose commands backed by shared context store services that use GM storage and BroadcastChannel synchronization. Selector maps reside in JSON under `packages/selectors`, while inspector and recorder packages provide overlay UX, stability scoring, and export pipelines that serialize new selectors and DSL steps into the same module graph. Build targets in `apps/userscripts` and `apps/wxt-extension` compile identical TypeScript packages through Vite with vite-plugin-monkey and WXT, guaranteeing parity between userscript and MV3 distributions.

## Risks & Mitigations
- **Selector Drift:** Favor semantic-first strategies (role, label, text, data attributes) with scoped fallbacks; recorder surfaces stability scores and notes to guide upkeep.
- **CSP Injection Blocks:** Maintain MV3 packaging via WXT so restricted sites can run the same modules without unsafe-eval concerns.
- **Infinite Scroll or Wait Loops:** Enforce scrollUntil termination caps, wait timeouts, and structured `[DGX]` logs that expose reasons for halting.
- **PII Exposure Through Recording:** Default to masked inputs, enforce `${ctx:...}` placeholders, and sanitize logs via recorder utilities.
- **HUD or Overlay Conflicts:** Namespaced styles, configurable z-index, and quick disable toggles prevent inspector and recorder UI from clashing with page chrome.
- **Cross-Tab State Desync:** Combine GM value change listeners with BroadcastChannel signaling and TTL enforcement so context updates stay consistent.

## Glossary
- **Selector Map:** JSON mapping of logical keys to ordered locator strategies with stability metadata generated by the inspector and recorder.
- **Workflow DSL:** Declarative step definitions (click, wait, scroll, collect, assert, conditional, foreach) executed by the workflows engine.
- **HUD:** Floating DGX command palette and status interface mirrored by native GM menu commands for workflow control.
- **Context Store:** GM-backed, BroadcastChannel-synchronized state container that exposes get/set/delete/subscribe with optional TTL.
- **Inspector:** Overlay that previews element metadata, ranks selector strategies, and guides authors toward stable logical keys.
- **Recorder:** Session tooling that captures page interactions, applies masking, and exports selectors plus workflow steps directly into packages.
- **ScrollUntil:** Utility that advances page or container scroll in bounded steps until an end condition, logging reasons for completion.
- **Logical Key:** Stable identifier used across selectors, workflows, and recorder exports to decouple automation logic from raw DOM queries.
