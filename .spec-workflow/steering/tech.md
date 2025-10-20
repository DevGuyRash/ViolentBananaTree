Project Type
Multi-target browser automation foundation distributed as Tampermonkey/Violentmonkey userscripts with an optional MV3 extension build, implemented in TypeScript and bundled via Vite ecosystems.

Primary Languages & Tooling
- **Language**: TypeScript (strict mode) for all packages, workflows, and build tooling.
- **Runtime/Compiler**: Node.js (LTS) with Vite for bundling userscripts, WXT for MV3 builds.
- **Package Managers**: npm (workspaces) managing packages under `packages/` and applications under `apps/`.

Key Dependencies & Frameworks
- **vite-plugin-monkey**: Userscript bundling and dev server with live reload.
- **WXT**: MV3 bundler ensuring extension parity without webpack.
- **GM_* APIs**: `GM_getValue`, `GM_setValue`, `GM_deleteValue`, `GM_addValueChangeListener`, `GM_removeValueChangeListener`, `GM_registerMenuCommand`, `GM_addStyle`.
- **BroadcastChannel**: Cross-tab synchronization for context store updates.
- **Mermaid** (authoring docs/diagrams) via Vite asset pipeline when required.

Application Architecture
- Modular monorepo with packages for core utilities (DOM, waits, resolver), workflows engine, menu HUD, context store, selector definitions, inspector, recorder, and script registry.
- Userscript shell loads page registry, resolves selectors, mounts HUD, and runs workflows.
- Optional MV3 build reuses the same packages, exporting content scripts via WXT entrypoints.

Data Storage & State
- Primary storage: Userscript manager key/value store (Tampermonkey/Violentmonkey) accessed via GM APIs.
- Sync: BroadcastChannel plus GM change listeners for multi-tab coherence.
- Data format: JSON structures for selector maps, workflow definitions, context values.
- TTL: Context store enforces optional time-to-live per key during reads.

External Integrations
- Browser APIs only (DOM, events, storage). No backend services or network APIs in MVP.
- Optional environment variable templating (`${env:NAME}`) for workflows; evaluation occurs client-side.

Monitoring & Observability
- Logs: `[DGX]` prefixed console logs for workflow start/stop, selector attempts, misses, scroll termination reasons, context changes.
- Timeline: Recorder and HUD emit structured logs for replay and debugging.
- Telemetry: Client-side only; potential future opt-in analytics must remain privacy-preserving.

Development Environment
- Build system: npm scripts orchestrating Vite (userscript) and WXT (extension) builds, plus TypeScript compilation.
- Watch/Dev: `npm run dev` launches Vite dev server with live reload user script install URL.
- Code quality: ESLint (TypeScript rules), Prettier or project style conventions, TypeScript strict mode.
- Testing: Unit/smoke tests for core utilities and workflows engine; manual validation via demo pages and recorder replays.
- Docs tooling: Markdown-first with Mermaid diagrams; inline JSDoc for critical APIs.
- Version control: Git with main branch default; Conventional Commit scopes (core, workflows, menu, selectors, inspector, recorder, docs, build).

Deployment & Distribution
- Userscript distribution: Build outputs `.user.js` files placed under `apps/userscripts/dist`. Dev install served via Vite dev server.
- Extension distribution: WXT outputs MV3 artifacts under `apps/wxt-extension/dist` ready for packaging/side-loading.
- Installation requirements: Tampermonkey or Violentmonkey extension installed; for MV3, Chrome/Chromium with developer mode.
- Updates: Rebuild and reinstall userscript/extension; doc updates accompany releases.

Technical Requirements & Constraints
- **Performance**: Default wait polling ≤ 150ms; step timeouts ≤ 8s; scrollUntil max steps and timeout enforced; avoid heavy DOM polling.
- **Compatibility**: Chrome + Firefox; Tampermonkey and Violentmonkey compatibility guaranteed; MV3 build optional but parity expected.
- **Security**: No `unsafe-eval`; rely on injected CSS via `GM_addStyle`; sanitize logged data; mask sensitive inputs by default.
- **CSP**: Userscripts must comply with target page CSP; fallback to MV3 when injection restricted.
- **Accessibility**: Selector strategies prioritize roles, labels, and accessible names.
- **Privacy**: No remote telemetry by default; masked recorder inputs; context store scoped per script and namespaced per page.

Scalability & Reliability
- Selector system with scoped fallbacks reduces brittleness; inspector assigns stability scores and notes uniqueness.
- Workflow engine supports retries/backoff and clear error messaging for recoverability.
- Scroll and collect utilities enforce termination conditions to avoid infinite loops.
- Recorder exports reproducible DSL steps ensuring consistent automation results.

Technical Decisions & Rationale
1. **Vite + vite-plugin-monkey** chosen for modern build tooling with hot reload and userscript-specific bundling; avoids webpack complexity.
2. **WXT** selected to share code between userscript and MV3 extension without dual maintenance.
3. **Logical selector keys** ensure workflows remain implementation-agnostic; inspector/recorder enforces disciplined selector creation.
4. **GM storage + BroadcastChannel** provide cross-tab state without external services, aligning with privacy-first goals.
5. **Declarative DSL** offers auditability and spec alignment, contrasting with imperative script automation.

Known Limitations
- Userscript storage quotas and BroadcastChannel availability vary by browser; large data sets should remain small.
- CSP-restricted pages may still block injected styles/scripts; MV3 build is fallback but requires manual installation.
- Recorder heavy DOM observation could impact performance on extremely complex pages; mitigate via configurable sampling and teardown.
- No backend telemetry; debugging relies on client logs and HUD feedback.

Open Technical Questions
- Whether to adopt optional telemetry/event buffering for workflow analytics post-MVP.
- Potential schema evolution for selector maps (versioning, migration strategy) as recorder features expand.
- Strategy for packaging shared TypeScript types for external consumers if the foundation becomes a dependency.
