- [ ] 1. Draft charter narrative
  - File: .spec-workflow/specs/dgx-modular-userscripts-foundation-program-charter-backlog/guide-charter.md
  - Capture vision, problem, personas, goals, non-goals, constraints, architecture, success metrics, risks, glossary using steering terminology.
  - _Leverage: project_overview.md, .spec-workflow/steering/product.md, .spec-workflow/steering/tech.md_
  - _Requirements: Requirement 1 — Charter_
  - _Prompt: Role: Product Strategist specializing in automation platforms | Task: Implement the charter narrative for spec dgx-modular-userscripts-foundation-program-charter-backlog, first run spec-workflow-guide to get the workflow guide then implement the task: capture vision, problem, goals, success metrics, non-goals, personas, constraints, high-level architecture, risks, and glossary aligned with steering docs | Restrictions: Keep language implementation-agnostic, reuse steering terminology, no new scope beyond overview | _Leverage: project_overview.md, steering/product.md, steering/tech.md | _Requirements: Requirement 1 — Charter | Success: Charter document approved with complete narrative and accurate terminology, risks mapped to mitigations._

- [ ] 2. Build feature backlog by streams
  - File: .spec-workflow/specs/dgx-modular-userscripts-foundation-program-charter-backlog/guide-backlog.md
  - Group backlog entries under Core, Workflows, UI/HUD, Selector System, Inspector, Recorder, Context Store, Scroll & Collect, Build & Tooling, Docs with value statements and dependencies.
  - _Leverage: project_overview.md, requirement acceptance criteria_
  - _Requirements: Requirement 2 — Feature Backlog & Milestones_
  - _Prompt: Role: Program Manager experienced in backlog curation | Task: Implement the task for spec dgx-modular-userscripts-foundation-program-charter-backlog, first run spec-workflow-guide to get the workflow guide then implement the task: create backlog grouped by the specified streams with concise value framing, highlight dependencies and recorder-first priorities | Restrictions: Keep items implementation-agnostic, reuse existing module names, avoid new terminology | _Leverage: project_overview.md | _Requirements: Requirement 2 — Feature Backlog & Milestones | Success: Backlog approved with all streams populated and dependencies clear._

- [ ] 3. Define milestones and acceptance bar
  - File: .spec-workflow/specs/dgx-modular-userscripts-foundation-program-charter-backlog/guide-milestones.md
  - Translate backlog into MVP/Post-MVP checklists and articulate project-wide acceptance bar criteria.
  - _Leverage: requirement acceptance criteria, steering success metrics_
  - _Requirements: Requirement 2 — Feature Backlog & Milestones, Requirement 3 — Acceptance Bar & Open Questions_
  - _Prompt: Role: Release Manager focused on automation quality | Task: Implement the task for spec dgx-modular-userscripts-foundation-program-charter-backlog, first run spec-workflow-guide to get the workflow guide then implement the task: produce MVP and post-MVP milestones with feature checklists and define the cross-feature acceptance bar referencing steering constraints | Restrictions: Do not introduce new milestones beyond MVP/post-MVP, ensure alignment with success metrics | _Leverage: steering success metrics, requirements.md | _Requirements: Requirement 2 — Feature Backlog & Milestones, Requirement 3 — Acceptance Bar & Open Questions | Success: Milestones and acceptance bar approved with explicit checklists._

- [ ] 4. Resolve open questions log
  - File: .spec-workflow/specs/dgx-modular-userscripts-foundation-program-charter-backlog/guide-open-questions.md
  - Summarize outstanding decisions, proposed answers, owners, and next steps to keep spec actionable.
  - _Leverage: requirements.md (Decisions & Resolutions section)_
  - _Requirements: Requirement 3 — Acceptance Bar & Open Questions_
  - _Prompt: Role: Stakeholder Coordinator experienced in decision tracking | Task: Implement the task for spec dgx-modular-userscripts-foundation-program-charter-backlog, first run spec-workflow-guide to get the workflow guide then implement the task: create an open-questions log capturing pending decisions, current stance, and owner/follow-up notes | Restrictions: No speculative answers beyond steering docs, mark items resolved where decisions exist | _Leverage: requirements.md | _Requirements: Requirement 3 — Acceptance Bar & Open Questions | Success: Open-questions log approved with clear accountability and no unresolved duplicates._
