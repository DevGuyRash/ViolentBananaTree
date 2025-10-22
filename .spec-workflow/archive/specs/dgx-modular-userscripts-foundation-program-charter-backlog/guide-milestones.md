## Milestone Checklists

### MVP Checklist
- Declarative workflow DSL covers recorder-exported step catalog (click/type/select/scroll/collect/conditional/assert) with retries that satisfy `selector miss rate < 5%` mitigation goals.
- Core resolver, retry guards, and structured `[DGX]` logging wired so recorder replays surface actionable diagnostics within the `≤8 s` timeout and `≤150 ms` polling constraints.
- HUD command palette plus Tampermonkey/Violentmonkey native menus expose the same workflow launch, status, and recorder toggles ensuring `Time to new workflow ≤ 10 minutes` from recorder capture to runnable command.
- Inspector surfaces stability scoring rationale and scope guidance using the selector map schema so recorded selectors meet semantic-first priorities.
- Recorder timeline exports accurate selectors (≥95% accuracy) with masking enforcement and immediate run validation, handing off to workflows without manual edits.
- Context store synchronizes via GM storage + BroadcastChannel, with TTL/conflict policies validated across tabs and refreshes.
- ScrollUntil and CollectList utilities guard against infinite loops and over-collection while emitting diagnostics used by HUD panels.
- Vite + vite-plugin-monkey userscript build and WXT MV3 packaging share the same smoke workflow harness that validates parity across targets.
- Docs backlog items delivering recorder-first quick start, selector governance, and build parity notes seeded enough to guide AI agents per steering "documentation as contract" principle.

### Post-MVP Checklist
- Recorder import/export bundles, timeline grouping, and plugin hooks expand authoring depth while preserving the ≥95% export accuracy success metric.
- Selector auto-healing research tracks conditions for automated logical key updates tied to stability scoring thresholds.
- MV3 side-panel UX ships with HUD overlays remaining performant on CSP-restricted pages, keeping parity across distributions.
- Optional telemetry strategy defined for selector miss analytics with privacy safeguards and opt-in alignment to non-goal boundaries.
- Localization and accessibility enhancements for HUD/recorder overlays validated against performance budgets.
- Advanced assertions, on-fail recovery flows, and workflow validation harness extensions cover high-risk automations identified in backlog streams.
- CI/spec governance tooling enforces selector schema linting, recorder masking, and milestone acceptance checks within the build pipeline.

## Cross-Feature Acceptance Bar
- **Selector Stability:** Semantic-first logical keys validated by inspector uniqueness metrics with fallbacks documented; workflows must demonstrate `<5%` selector miss rate during smoke runs.
- **Recorder Fidelity:** Newly recorded flows export and replay end-to-end without manual selector edits, retaining default masking for sensitive inputs and logging redactions.
- **Parity Assurance:** Tampermonkey, Violentmonkey, and MV3 bundles pass the shared smoke workflow harness with identical HUD diagnostics and native menu behavior.
- **Performance Guardrails:** Workflow execution honors `≤150 ms` polling cadence and `≤8 s` per-step timeout, with scroll/collect utilities confirming safe termination on long lists.
- **Context Integrity:** BroadcastChannel + GM storage synchronization demonstrates TTL adherence and conflict resolution across multiple tabs and refresh cycles.
- **Observability & Docs:** `[DGX]` structured logs, HUD diagnostics panels, and recorder notes feed into docs updates (quick start, selector governance) before release, ensuring contributors can trace success metrics and mitigations.
