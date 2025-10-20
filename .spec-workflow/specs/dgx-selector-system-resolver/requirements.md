\# Requirements Document

\## Introduction

DGX needs a resilient selector foundation that lets page modules and the recorder share the same logical keys while surviving inevitable DOM churn. This feature establishes a per-site SelectorMap JSON schema with scoped strategies, stability metadata, and a resolver that executes ordered lookups, emits observability signals, and degrades gracefully so workflows recover or fail loudly with context.

\## Alignment with Product Vision

The project vision stresses recorder-first authoring, selector stability, and transparent automation. Logical selector maps and an ordered resolver directly reinforce those goals by keeping workflows declarative, surfacing misses, and shortening the time to ship new automations, all while honoring the Swiss Army Knife scaffold described in product.md.

\## Requirements

\### Requirement 1

**User Story:** As a script author, I want to define selectors in a structured per-site JSON map so that workflows and the recorder reuse stable logical keys with clear metadata.

#### Acceptance Criteria

1. WHEN a new selector entry is added THEN the JSON schema SHALL support `description`, `scopeKey`, `tags`, `stabilityScore`, and an ordered `tries` array covering role/name/label/text → data attributes/test ids → CSS → XPath.
2. IF a selector requires container scoping THEN the schema SHALL allow referencing another logical key as the search root.
3. WHEN the recorder exports selectors AND an existing logical key exists THEN the map SHALL merge strategies without dropping prior metadata.

\### Requirement 2

**User Story:** As the automation runtime, I want a resolver that evaluates strategies in priority order so that workflows keep running with the most reliable locator available.

#### Acceptance Criteria

1. WHEN resolving a logical key THEN the resolver SHALL attempt strategies in schema order and stop on the first DOM match.
2. IF all strategies fail within the scoped container THEN the resolver SHALL log a miss event with the key, strategies attempted, and final failure reason.
3. WHEN a strategy succeeds THEN the resolver SHALL record which locator type resolved the element for downstream stability scoring.

\### Requirement 3

**User Story:** As a recorder user, I want selector stability and diagnostics captured with each key so that I can understand risk and tune strategies quickly.

#### Acceptance Criteria

1. WHEN the recorder suggests strategies THEN each suggestion SHALL include a stability score (0.0–1.0), uniqueness flag, and optional notes stored on the chosen `tries` entry.
2. IF a selector miss occurs at runtime THEN the HUD or log output SHALL surface the miss with the stored stability score and tags for triage.
3. WHEN selector metadata changes via the recorder or manual edits THEN the system SHALL persist updated tags, notes, and scores without reordering unrelated strategies.

\### Requirement 4

**User Story:** As a workflow maintainer, I want selector resolution to degrade gracefully so that failures remain actionable without breaking unrelated steps.

#### Acceptance Criteria

1. IF the resolver cannot find an element THEN it SHALL emit a structured miss event consumable by telemetry/log sinks and allow the workflow to decide retry/backoff policies.
2. WHEN a miss is detected THEN the workflow engine SHALL mark the step as failed while leaving context data intact for recovery steps.
3. IF a strategy is marked unstable (via low stability score or tags) THEN the resolver SHALL expose that status to the HUD so authors can prioritize fixes.

\## Non-Functional Requirements

\### Code Architecture and Modularity
- **Single Responsibility Principle**: JSON schema validation, selector resolution, and logging SHALL live in separate modules under `packages/selectors` and `packages/core` to ensure reuse.
- **Modular Design**: The resolver SHALL accept injected logging and observation hooks so recorder, workflows, and tests reuse it without tight coupling.
- **Dependency Management**: Use native DOM APIs only; avoid introducing new third-party selector libraries.
- **Clear Interfaces**: Provide TypeScript types for `SelectorMap`, `SelectorStrategy`, and resolver results so engines and inspector share a contract.

\### Performance
- Selector resolution SHALL resolve common strategies (role/data attr/CSS) within 50ms under normal page load; retries use existing workflow backoff policies.
- Schema parsing SHALL occur once per page load and cache results to avoid repeated JSON parsing.

\### Security
- Avoid dynamic `eval` or Function constructors when creating XPaths; rely on native DOM evaluation.
- Ensure logged data redacts sensitive attribute values per existing sanitize utilities before surfacing in HUD or console.

\### Reliability
- Resolver SHALL support retries configured by the workflow engine and provide deterministic ordering to minimize flake.
- On schema validation failure, the system SHALL fail fast with actionable errors rather than proceed with partial data.

\### Usability
- Recorder UI SHALL display strategy order and stability scores clearly, helping authors choose primary selectors.
- JSON schema SHALL include comments/examples in onboarding docs so contributors can extend maps without tooling friction.
