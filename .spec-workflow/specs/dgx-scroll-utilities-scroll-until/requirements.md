# Requirements Document

## Introduction

DGX needs resilient scroll utilities that can detect the correct scroll container, bring targets safely into view, and continue scrolling until end conditions are satisfied without risking runaway loops. This specification establishes the contractual behaviors for `scrollIntoView` and `scrollUntil` so recorder exports, workflow runners, and AI agents share deterministic semantics across infinite lists, lazy-loading feeds, and complex layouts.

## Alignment with Product Vision

Recorder-first authoring and selector stability demand predictable scroll helpers that respect semantic locators, prevent accidental overscroll, and surface actionable diagnostics. These utilities expand the Scroll & List capabilities described in steering docs by pairing heuristic container discovery with observable termination signals, ensuring HUD timelines and recorder notes clearly communicate why scrolling stopped or failed.

## Requirements

### Requirement 1 — Scroll Container Detection

**User Story:** As a workflow author, I want automatic scroll container detection so that scrolling actions operate on the intended element even when pages use nested overflow containers.

#### Acceptance Criteria

1. WHEN a scroll helper executes without an explicit container override THEN it SHALL resolve the scroll root by checking (in order) the target element’s nearest ancestor with `overflow` allowing scroll, known DGX selector hints (e.g., `data-dgx-scroller`), and fallback keys supplied in workflow context.
2. IF no ancestor qualifies AND selector hints fail THEN the helper SHALL fallback to `document.scrollingElement` (or `document.body` in legacy browsers) and record that fallback in diagnostics.
3. WHEN heuristics evaluate potential containers THEN the helper SHALL emit telemetry describing the evaluated path and final choice so recorder exports and HUD logs can surface the rationale.

### Requirement 2 — `scrollIntoView` Safety

**User Story:** As a workflow runner, I want `scrollIntoView` to honor alignment options and safe padding so that elements land within the viewport without being obscured or causing jarring jumps.

#### Acceptance Criteria

1. WHEN `scrollIntoView` runs THEN it SHALL accept alignment options (`start`, `center`, `end`, `nearest`) with defaults defined in configuration and translate them into numeric offsets to avoid browser-specific inconsistencies.
2. IF the helper detects sticky headers or fixed banners within the viewport margins THEN it SHALL apply a safety inset (configurable, default 16px) to prevent target occlusion and log the applied adjustment.
3. WHEN `scrollIntoView` completes THEN it SHALL resolve only after verifying the element’s bounding box resides fully within the viewport (respecting safety inset) or else retry with a bounded attempt count before surfacing a structured failure.

### Requirement 3 — `scrollUntil` Modes

**User Story:** As a script maintainer, I want a single `scrollUntil` API that supports end-of-list, target element, list growth, and predicate-based stopping conditions so that I can handle varied infinite scroll behaviors without bespoke code.

#### Acceptance Criteria

1. WHEN `scrollUntil` is invoked with `mode: "end"` THEN it SHALL continue scrolling while cumulative scroll deltas exceed a minimum threshold and SHALL terminate once two consecutive attempts produce deltas below that threshold.
2. WHEN called with `mode: "element"` THEN it SHALL resolve target selectors via the DGX selector system each attempt and complete successfully only after the element is visible within the viewport; failures SHALL cite the last resolver status.
3. WHEN configured for `mode: "list growth"` THEN it SHALL poll a supplied list container (or selector) and terminate once item count increases by the configured amount (default ≥1), recording the counts observed each step.
4. WHEN configured for `mode: "predicate"` THEN it SHALL execute a provided predicate callback after each scroll and consider scrolling complete only when the predicate returns truthy; predicate errors SHALL be caught, logged, and treated as failures with sanitized stack traces.

### Requirement 4 — Tuning Parameters and Budgets

**User Story:** As a workflow tuner, I want granular control over step size, max attempts, inter-step delay, and overall timeout so that scroll utilities can be tailored to different page performance characteristics.

#### Acceptance Criteria

1. WHEN `scrollUntil` executes THEN it SHALL merge caller-provided options with system defaults (step size in pixels, attempt cap, delay in milliseconds, timeout budget) using the workflow configuration store as a base.
2. IF the computed overall timeout expires BEFORE a success condition THEN the helper SHALL abort immediately, emit a timeout error including elapsed time, attempt count, and remaining delta, and mark the run as failure.
3. WHEN step size or inter-step delay are overridden THEN the helper SHALL validate they fall within steering guard rails (≤ 500px per step, delay ≤ 1000ms) and clamp values while logging any clamping for observability.

### Requirement 5 — Termination and No-Change Detection

**User Story:** As a HUD observer, I want clear termination logic that distinguishes success, exhaustion, and no-change states so that I can troubleshoot why scroll operations stopped.

#### Acceptance Criteria

1. WHEN two consecutive scroll attempts result in `scrollTop` and `scrollLeft` deltas below the configured minimum threshold THEN the helper SHALL classify the outcome as `no_change` and stop further scrolling.
2. WHEN DOM observation detects no new child nodes, attribute mutations, or text changes within the monitored container for the configured stability window THEN the helper SHALL include a `dom_stable` flag in its result payload.
3. WHEN a run fails (timeout, no change, predicate error, resolver miss) THEN the helper SHALL return a structured failure object with reason codes (`timeout`, `no_change`, `predicate_error`, `resolver_miss`, `dom_stable_no_match`) so downstream components can branch deterministically.

### Requirement 6 — Logging and Telemetry

**User Story:** As a telemetry analyst, I want standardized logs for scroll failures that are sanitized yet actionable so that I can trace issues without exposing sensitive data.

#### Acceptance Criteria

1. WHEN scroll helpers run THEN they SHALL emit `[DGX] scroll` telemetry events containing timestamp, container key, mode, attempt index, scroll delta, item counts (when applicable), and predicate outcomes while masking selectors flagged as sensitive.
2. IF a failure occurs THEN the helper SHALL log a structured error payload with severity `warning` for recoverable conditions and `error` for terminal failures, including sanitized selector metadata, last known scroll position, and termination reason.
3. WHEN telemetry is dispatched THEN it SHALL integrate with existing workflow event channels so recorder timelines and HUD consoles display scroll progress, heartbeat updates, and failure narratives consistent with wait utilities.

### Requirement 7 — Recorder and Selector Integration

**User Story:** As a recorder maintainer, I want scroll utilities to cooperate with recorder annotations and selector resolution so that exported workflows capture scroll intent and selectors remain stable.

#### Acceptance Criteria

1. WHEN recorder captures a scroll interaction THEN it SHALL annotate the exported step with detected container heuristic results, selected mode, and tuning parameters, storing them in workflow metadata for replay.
2. WHEN `scrollUntil` resolves target selectors THEN it SHALL use the selector system’s strategy ordering and return strategy history so recorder and AI agents can adjust selectors when drift occurs.
3. WHEN recorder replays a workflow THEN scroll helpers SHALL expose hooks to inject synthetic predicate functions or list growth expectations derived from recorder context, ensuring deterministic playback in authoring sessions.

### Requirement 8 — End-to-End Acceptance Coverage

**User Story:** As a QA engineer, I want acceptance scenarios that validate scroll heuristics, modes, logging, and integrations end-to-end so that regressions are caught before release.

#### Acceptance Criteria

1. WHEN the automated acceptance suite runs on demo pages with infinite lists, lazy loaders, and sticky headers THEN it SHALL assert successful completion for each `scrollUntil` mode, verifying that recorder annotations reflect final parameters.
2. WHEN negative tests simulate unchanging scroll positions or exhausted content THEN telemetry logs SHALL include `no_change` reasons and HUD timelines SHALL display the same reason codes.
3. WHEN recorder-driven workflows execute under both Tampermonkey and MV3 builds THEN scroll helpers SHALL produce identical telemetry structures and termination outcomes, confirming cross-target parity.

## Non-Functional Requirements

### Code Architecture and Modularity
- **Single Responsibility Principle**: Keep container detection, scrolling mechanics, predicate evaluation, telemetry, and recorder bridges in separate modules exported through `@core/utils/scroll`.
- **Modular Design**: Expose factory functions that accept injected resolver, telemetry, and timing dependencies to align with DGX package layering.
- **Dependency Management**: Reuse existing selector resolver, telemetry adapters, and wait scheduler primitives; disallow new third-party scrolling libraries without steering updates.
- **Clear Interfaces**: Define TypeScript contracts for `ScrollUntilOptions`, `ScrollResult`, `ScrollFailure`, and recorder metadata so downstream packages consume typed APIs.

### Performance
- Default step sizes SHALL keep per-attempt scroll durations under 100ms and respect overall timeouts ≤ 8000ms unless overrides are approved.
- Inter-step delays SHALL support jitter to avoid synchronized scroll loops when multiple workflows run concurrently.
- Observation hooks (mutation, intersection) SHALL disconnect promptly to prevent memory leaks in long-running sessions.

### Security
- Telemetry SHALL redact inner text, attribute values, and predicate function bodies flagged as sensitive before logging.
- Helpers SHALL avoid injecting inline scripts or relying on unsafe browser APIs, instead using native scrolling and requestAnimationFrame timers.

### Reliability
- Scroll helpers SHALL guarantee deterministic termination states even under rapid DOM churn by enforcing maximum attempts and stability windows.
- Structured error codes SHALL remain stable for downstream contracts and be documented in recorder annotations.

### Usability
- Recorder exports SHALL include human-readable notes summarizing which heuristic picked the container and why scrolling stopped.
- HUD consoles SHALL surface scroll progress with percentage-to-target estimates where applicable, guiding operators on manual intervention.
