# Requirements for Selector System & Resolver

## 1. Outcomes

- **Reliability**: Workflows must remain stable despite minor UI changes by using a graceful degradation strategy for selectors.
- **Maintainability**: Selector definitions must be decoupled from workflow logic, residing in a dedicated, human-readable JSON format (`SelectorMap`).
- **Traceability**: All selector misses must be logged with clear, actionable information, indicating which logical key and strategy failed.
- **DX (Developer Experience)**: Authors should be able to define and reference elements using simple, logical keys without embedding raw CSS or XPath locators directly into workflow steps.

## 2. Scope

- **In Scope**:
  - A `SelectorMap` JSON schema definition for storing ordered selector strategies per logical key.
  - A resolver function that iterates through these strategies in order.
  - Support for scoping selectors within a container element.
  - Graceful degradation (trying multiple strategies before failure).
  - Logging for successful resolutions and failures.
  - Metadata in the `SelectorMap` including descriptions, tags, and a stability score.
- **Out of Scope**:
  - Auto-healing or self-correcting selectors.
  - A visual tool for picking selectors (this is part of the Recorder spec).
  - The workflow engine that consumes the resolver's output.

## 3. Constraints & Dependencies

- **Constraint**: Must be implemented in TypeScript.
- **Constraint**: The final implementation must not rely on external libraries for core selector resolution (standard browser DOM APIs are required).
- **Dependency**: A logging utility must be available to report misses.
- **Dependency**: The system will be consumed by a workflow engine that operates on logical keys.

## 4. Acceptance Criteria

| ID          | Description                                                                                                                                                                |
|-------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **AC-REQ-1**  | A `SelectorMap` JSON file can be created and validated against a defined schema, containing at least one logical key with an ordered array of selector strategies.             |
| **AC-REQ-2**  | The resolver function, when given a logical key, sequentially attempts each strategy defined in the `SelectorMap` until an element is found.                               |
| **AC-REQ-3**  | If a strategy succeeds, the resolver returns the found `Element` and ceases further attempts for that key.                                                                 |
| **AC-REQ-4**  | If all strategies for a key fail, the resolver returns `null` and logs a "selector miss" error detailing the logical key and all attempted strategies.                     |
| **AC-REQ-5**  | The supported selector strategies must include: by role/name/label/text, by test id/data attribute, by CSS selector, and by XPath.                                         |
| **AC-REQ-6**  | The resolver must support a `scopeKey` within a selector entry, limiting the search for the target element to within the bounds of the element found by the `scopeKey`.    |
| **AC-REQ-7**  | The `SelectorMap` JSON schema must support optional fields for `description`, `tags`, and `stabilityScore` for each logical key, allowing for better documentation and hints.|

## 5. Edge Cases & Knowns

- **Stale Elements**: The resolver should not be responsible for handling stale element references; this is the responsibility of the consuming workflow engine.
- **Multiple Matches**: If a strategy finds multiple elements, the resolver shall return the first one found, consistent with `querySelector`.
- **Hidden Elements**: The resolver does not need to check for element visibility; this is a separate concern to be handled by the workflow engine's action steps (e.g., a `waitForVisible` step).
- **Shadow DOM**: Initial implementation will not support piercing Shadow DOM boundaries. This is a known limitation.

## 6. Observability & Telemetry

- A structured log event must be emitted for every selector miss. The log should contain:
  - `level`: "error"
  - `event`: "selector_miss"
  - `logicalKey`: The key that failed to resolve.
  - `attemptedStrategies`: An array of strings describing each failed strategy.
- A "debug" level log should be available to trace the successful resolution of a key, including which strategy succeeded.

## 7. Risks

| Risk ID      | Description                                                                                             | Mitigation                                                                                                                                             |
|--------------|---------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------|
| **RISK-SEL-1** | Overly complex selector logic could impact performance, especially with deep XPath queries.             | Prioritize faster, more semantic strategies (role, data-attr, CSS) over XPath. Document performance characteristics and recommend best practices.         |
| **RISK-SEL-2** | Poorly chosen selectors in the `SelectorMap` could still lead to brittle workflows.                     | This is mitigated by the Recorder/Inspector tool, which will suggest stable selectors and assign a `stabilityScore`. The resolver itself cannot prevent this. |
| **RISK-SEL-3** | Ambiguity in selector strategies (e.g., non-unique text) could lead to incorrect element resolution.    | The resolver will return the first match. Documentation and the Recorder tool must guide authors to provide unique and stable locators.               |

## 8. Open Questions

1. Should the resolver support a custom function as a strategy type for maximum flexibility? (Decision: Defer for post-MVP, adds complexity).
2. How should we handle internationalization (i18n) for text-based selectors? (Decision: For now, text matching will be exact or case-insensitive. Full i18n is a broader concern).
