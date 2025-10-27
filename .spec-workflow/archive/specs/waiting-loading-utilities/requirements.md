# Requirements Document

## Introduction

DGX requires dedicated waiting and loading utilities that standardize how workflows pause for DOM readiness, visible UI states, and text mutations. This feature equips recorder exports and hand-authored automations with resilient wait primitives aligned to selector stability scoring, ensuring flows survive dynamic pages, surface actionable diagnostics, and avoid unbounded polling loops.

## Alignment with Product Vision

Recorder-first authoring and selector stability are core tenets of the DGX foundation. Unified wait helpers let script authors rely on logical selector keys while transparently falling back to CSS, XPath, or text probes when required. Consistent telemetry, timeouts, and error narratives reinforce the HUD’s role as a trustworthy automation dashboard and keep AI agents within documented guard rails.

## Requirements

### Requirement 1

**User Story:** As a workflow author, I want wait utilities that resolve logical selector keys and gracefully fall back to CSS, XPath, or text probes so that my automations stay stable across markup churn.

#### Acceptance Criteria

1. WHEN `waitFor` is invoked with a logical key THEN the resolver SHALL attempt strategies in stability order and attach strategy history to the result payload.
2. IF a `waitFor` call provides explicit `css`, `xpath`, or `textContains` overrides THEN the utility SHALL execute those fallbacks only after the logical key path fails or when `key` is omitted by design.
3. WHEN resolution succeeds THEN the utility SHALL return both the found node reference and metadata (strategy used, attempt count, timestamp) for downstream logging.

### Requirement 2

**User Story:** As a workflow runner, I want specialized helpers like `waitText`, `waitVisible`, and `waitHidden` so that I can observe loading states and copy changes without writing custom polling logic.

#### Acceptance Criteria

1. WHEN `waitText` is called THEN it SHALL evaluate the text content of the resolved target until it matches `exact`, `contains`, or `regex` predicates, supporting context-driven expectations.
2. WHEN `waitVisible` or `waitHidden` executes THEN they SHALL poll computed visibility, accounting for CSS `display`, `visibility`, `opacity`, bounding box size, and intersection with the viewport.
3. IF the target detaches from the DOM during polling THEN the utilities SHALL automatically retry using the resolver until timeout thresholds are reached, marking the attempt as a stale-node recovery.

### Requirement 3

**User Story:** As a recorder maintainer, I want wait hooks that respect mutation-idle windows so that workflows can pause for asynchronous rerenders without over-polling or masking race conditions.

#### Acceptance Criteria

1. WHEN `waitForIdle` is configured with a mutation window THEN it SHALL rely on a shared `MutationObserver` gate that requires `idleMs` of no mutations before resolving.
2. IF a workflow sets both idle and visibility constraints THEN the idle window SHALL only start counting once visibility criteria are satisfied.
3. WHEN the idle window exceeds configured `maxWindowMs` THEN the utility SHALL emit a structured timeout error indicating observed mutation counts and last mutation timestamp.

### Requirement 4

**User Story:** As a HUD observer debugging a failure, I want consistent timeout caps, polling intervals, and `[DGX]` logs so that I can interpret why a wait stalled and what to adjust.

#### Acceptance Criteria

1. WHEN a wait utility starts THEN it SHALL derive polling interval ≤150ms and timeout ≤8000ms from workflow/system defaults unless explicit overrides are provided.
2. WHEN polling attempts occur THEN debug logs SHALL include logical key (when present), fallback strategy, elapsed time, and remaining budget, respecting sanitized output for sensitive selectors.
3. WHEN a wait fails THEN the thrown error SHALL include logical key, final strategy, elapsed duration, poll count, last seen text/visibility state, and guidance for recorder annotations.

### Requirement 5

**User Story:** As an AI agent extending DGX, I want constraints and edge-case handling baked into wait utilities so that dynamic UIs and stale nodes do not derail scripts.

#### Acceptance Criteria

1. WHEN the utility detects DOM mutations that replace the target THEN it SHALL re-run resolver strategies up to a bounded retry ceiling while preventing infinite loops.
2. IF the page uses virtualized lists or skeleton loaders THEN waits SHALL support configurable `presenceThreshold` and optional `scrollerKey` integration to synchronize with scroll utilities.
3. WHEN waits depend on dependencies such as the selector resolver or context store THEN the API surface SHALL express those dependencies explicitly, ensuring packages import from `@core/resolve` and shared wait scheduler modules instead of duplicating logic.

## Non-Functional Requirements

### Code Architecture and Modularity
- **Single Responsibility Principle**: Separate scheduler, predicate evaluation, and resolver orchestration modules; expose typed helpers via `packages/core/utils/wait` and re-export through barrel files.
- **Modular Design**: Wait utilities SHALL accept injected resolver, logger, and clock primitives to facilitate testing and cross-target parity.
- **Dependency Management**: Centralize fallback strategy ordering in one module shared with selector resolver to avoid drift; prohibit new third-party polling libraries unless steering updates.
- **Clear Interfaces**: Define TypeScript interfaces for `WaitOptions`, `WaitResult`, `VisibilityOptions`, `IdleWindowOptions`, and structured errors consumed by workflows and HUD telemetry.

### Performance
- Enforce default polling ≤150ms with jitter to avoid thundering herds; long waits SHALL log heartbeat events every 1s.
- Mutation observers SHALL disconnect after completion to prevent memory leaks and ensure MV3 background constraints are respected.

### Security
- SANITIZE debug logs by masking selectors flagged as sensitive (e.g., password fields) and never expose raw XPath in user-facing HUD messages.
- Avoid storing DOM node references globally; rely on weak maps or scoped closures to prevent leaking references across runs.

### Reliability
- All waits SHALL respect timeout ceilings even under rapid mutation; ensure stale node detection resets attempts without exceeding configured maximum retries.
- Provide deterministic error codes for timeout, resolver miss, idle window exceeded, and visibility mismatch to support telemetry filtering.

### Usability
- Recorder exports SHALL annotate inserted wait steps with rationale (selector fallback used, idle window expectations) for reviewer clarity.
- HUD SHALL surface wait progress (elapsed vs timeout, predicate state) through existing telemetry adapters so operators can adjust configs confidently.
