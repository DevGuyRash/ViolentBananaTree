Directory Organization

```
/ (repo root)
  README.md
  AGENTS.md
  CONTRIBUTING.md
  RECORDER.md
  project_overview.md
  .spec-workflow/
    steering/
      product.md
      tech.md
      structure.md
    specs/
    approvals/
    templates/
  packages/
    core/
      src/
        utils/
        locators.ts
        resolve.ts
        index.ts
    context/
      src/{store.ts,index.ts}
    menu/
      src/{hud.ts,tm-menu.ts,index.ts}
    workflows/
      src/{types.ts,engine.ts,index.ts}
    selectors/
      *.json
    inspector/
      src/{overlay.ts,picker.ts,selector-suggest.ts,sanitize.ts,index.ts}
    recorder/
      src/{session.ts,serialize.ts,to-workflow.ts,hotkeys.ts,index.ts}
    scripts/
      index.ts
      <site>/
        <page>.ts
  apps/
    userscripts/
      package.json
      tsconfig.json
      vite.config.ts
      dist/
    wxt-extension/
      package.json
      tsconfig.json
      wxt.config.ts
      src/entrypoints/content.ts

```

Naming Conventions
- Files: TypeScript source in `camelCase` or descriptive kebab-case where appropriate (e.g., `scroll-until.ts`); JSON selector maps in snake_case (e.g., `oracle.json`).
- Selector keys: lower_snake_case with clear intent (`save_button`, `toast_area`).
- Page module ids: `site-page` slug (e.g., `oracle-edit`).
- Workflow ids: dashed strings describing action (`fill-and-save`).
- Packages: lowercase descriptive names (`core`, `context`, `menu`).
- Logs: `[DGX]` prefix for all console output.

Import Patterns
1. External dependencies (Node/browser APIs, third-party libraries).
2. Internal packages via aliases (`@core`, `@context`, `@menu`, `@workflows`, `@selectors`, `@inspector`, `@recorder`).
3. Relative imports within package modules.
4. Style assets or CSS injections last (handled via `GM_addStyle`).

Code Structure Patterns
- Module files: imports → constants/types → main implementation → helpers → exports.
- Workflow definitions: selectors, workflows, and module metadata exported from page modules; DSL steps declared near usage with minimal inline logic.
- Utilities: single responsibility per file; expose typed functions via `index.ts` barrels.

Organization Principles
1. **Spec-Driven**: Every implementation artifact ties back to approved specs/steering; specs reside under `.spec-workflow/specs` with lifecycle status.
2. **Modularity**: Shared logic lives under `packages/`; page-specific code resides under `packages/scripts/<site>/`.
3. **Testability**: Core utilities and workflows engine expose pure, testable functions; page modules focus on configuration.
4. **Isolation**: Inspector and recorder packages contain overlay UI and event logic; they depend on resolvers but not vice versa.
5. **Cross-Target Parity**: Both userscript and MV3 builds import from the same packages; environment-specific code is isolated in application layer.

Module Boundaries
- `core`: DOM utilities, resolvers, wait/scroll/collect helpers; no knowledge of recorder HUD.
- `context`: Storage implementations and adapters; consumed by workflows engine and HUD.
- `menu`: HUD components and Tampermonkey/Violentmonkey menu registration.
- `workflows`: DSL types, engine execution, logging.
- `selectors`: JSON maps consumed by resolver utilities.
- `inspector`: Overlay + selector suggestion logic; emits mappings but does not write files directly.
- `recorder`: Uses inspector suggestions to build steps and selector entries; outputs data to page modules/selectors.
- `scripts`: Page modules referencing selectors, workflows, HUD/Hooks.
- `apps/userscripts`: Build pipeline; no business logic.
- `apps/wxt-extension`: MV3 packaging; thin wrapper around packages.

Code Size Guidelines
- Package modules target ≤ 300 lines per file; split large utilities by concern.
- Functions aim for ≤ 50 lines with clear branching; larger logic broken into helper functions.
- Page modules remain declarative (<200 lines) by offloading logic to packages.
- Avoid nested control flow beyond 3 levels; use early returns.

Spec & Documentation Handling
- Steering docs under `.spec-workflow/steering/` treated as canonical project charter; updates require approval workflow.
- Feature specs live in `.spec-workflow/specs/` following requirements → design → tasks templates; version and changelog per update.
- Approvals stored under `.spec-workflow/approvals/` with traceability to spec IDs and steering revisions.

Quality Gates
- Conventional commits referencing relevant scopes and spec IDs.
- PRs link to approved specs and demonstrate acceptance criteria via demo workflows or tests.
- Recorder exports validated before merge; include sample replay logs when feasible.
- Ensure both userscript and MV3 builds compile before release tags.

Decision Log Expectations
- Significant architecture or tooling decisions captured in specs or ADRs under `.spec-workflow/archive/` for historical context.
- Keep rationale updated when revisiting selectors, workflow patterns, or build strategy.
