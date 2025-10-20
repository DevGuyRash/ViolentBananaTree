Name
DGX Modular Userscripts Foundation

Summary
A forkable, recorder-first scaffold for building resilient browser automations as Tampermonkey and Violentmonkey userscripts, with an optional MV3 extension distribution. The foundation emphasizes declarative workflows, stability-focused selectors, cross-tab context sharing, and UI affordances (HUD + inspector/recorder) that make automation authoring fast and reliable.

Target Users
- Script Authors who need to stand up page-specific automations quickly without mastering low-level browser APIs.
- AI Agents tasked with extending the template by following deterministic schemas and docs.
- Power Users who execute automations through HUD or native userscript menus and expect clear feedback and configuration options.

Key Features
1. **Declarative Workflow Engine**: Click, type, wait, scroll, context, conditional, and assertion steps expressed in DSL form with retries and templating.
2. **Selector System with Stability Scoring**: Logical keys map to ordered locator strategies (role/name/text → data attributes → CSS → XPath) with scoped fallbacks and inspector-generated stability notes.
3. **HUD + Native Menu Interface**: A floating DGX command palette paired with Tampermonkey/Violentmonkey menu entries, offering workflow execution, status, and quick recorder toggles.
4. **Context Store**: GM storage plus BroadcastChannel synchronization so workflow state persists across tabs and refreshes with TTL handling.
5. **Visual Inspector & Recorder**: Overlay, selector suggestions, and action recording that export selectors and workflow steps while masking sensitive inputs by default.
6. **Scroll & List Utilities**: Scroll detectors, scrollUntil patterns, and list collection helpers to robustly automate infinite lists and data gathering.
7. **Dual Build Targets**: Vite + vite-plugin-monkey userscript build and optional WXT-based MV3 extension packaging from the same codebase.

Business Objectives
- Reduce time-to-first-automation to under 10 minutes through recorder-first authoring and clear docs.
- Deliver a resilient automation experience that surfaces selector misses and failure reasons explicitly.
- Ensure reusable modules (core actions, menu, context, selectors) underpin every page so the foundation scales to many sites without duplication.
- Provide a template that teams can fork with confidence, including spec-driven documentation that AI agents can follow autonomously.

Success Metrics
- `Time to new workflow ≤ 10 minutes` from empty module to runnable HUD command.
- `Selector miss rate < 5%` during target page changes, with clear logged context when misses occur.
- `Parity across TM/VM and MV3` builds validated by smoke workflows.
- `Recorder export accuracy ≥ 95%` requiring no manual selector rewrites for recorded flows.

Product Principles
1. **Selector Stability First**: Prefer semantic selectors (role/name/label/test-id) with inspector transparency before CSS/XPath fallbacks.
2. **Declarative Over Imperative**: Workflows describe intent via DSL steps, keeping automation logic observable, reusable, and testable.
3. **Recorder-First Authoring**: The inspector/recorder is the primary path to new automations; manual edits remain possible but secondary.
4. **Documentation as Contract**: README, AGENTS, and specs lead implementers; steering docs remain the canonical source for scope and constraints.
5. **Client-Only, No Backend**: All state stays in userscript storage and browser APIs; privacy-sensitive data remains local and masked when logged.

Monitoring & Visibility
- **Dashboard Type**: HUD overlay inside the page with mirrored native menus; no external dashboard for MVP.
- **Real-time Updates**: Workflow status badges, timeline logs, and recorder overlays update live within the HUD context.
- **Key Metrics Displayed**: Last run status, selector misses, scrollUntil termination reasons, context mutations, recorder step summaries.
- **Sharing Capabilities**: Workflows are shared by distributing the userscript/extension build; recorder exports produce JSON/TS artifacts that can be reviewed via PRs.

Future Vision
- Expand recorder to support import/export bundles, plugin hooks, and telemetry-assisted selector healing.
- Offer optional analytics on workflow success/failure (with client-side opt-in) and richer HUD dashboards.
- Introduce a side-panel UX for the MV3 build to enable multi-pane editing and replay, keeping hover overlays as a lightweight mode.
- Provide localization and accessibility enhancements for HUD and recorder tooling without sacrificing selector robustness.
