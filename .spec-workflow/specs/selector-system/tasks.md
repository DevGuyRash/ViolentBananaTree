# Tasks for Selector System & Resolver

This document outlines the engineering tasks required to implement the Selector System and Resolver as specified in the `requirements.md` and `design.md` documents.

## Task Breakdown

- [x] 1. **Setup Core Module Structure**
  - **Description**: Create the necessary files and directories within the `packages/core` module as outlined in the design document.
  - **Files to Create**:
    - `packages/core/src/locators.ts`
    - `packages/core/src/resolve.ts`
    - `packages/core/src/utils/dom.ts`
    - `packages/core/src/index.ts`
  - **Acceptance Criteria**: All files exist in the correct locations.

- [x] 2. **Define Data Structures in `locators.ts`**
  - **Description**: Implement the TypeScript types for the selector system (`SelectorStrategy`, `SelectorDefinition`, `SelectorMap`) in `packages/core/src/locators.ts`.
  - **Acceptance Criteria**:
    - The file `locators.ts` contains the exported types as defined in `design.md`.
    - Types are documented with TSDoc comments.

- [x] 3. **Implement DOM Utility Helpers in `dom.ts`**
  - **Description**: Implement the set of helper functions that perform the actual DOM queries (`byRole`, `byText`, `byDataAttr`, etc.) in `packages/core/src/utils/dom.ts`.
  - **Acceptance Criteria**:
    - Each helper function is implemented and exported.
    - Functions correctly use `querySelector`, `querySelectorAll`, or `document.evaluate` as appropriate.
    - Functions correctly handle the `root` parameter to search within a specific container.

- [x] 4. **Implement the Core `resolve` Function**
  - **Description**: Implement the main `resolve` function in `packages/core/src/resolve.ts`. This function will orchestrate the entire resolution process using the DOM helpers.
  - **Acceptance Criteria**:
    - The function signature matches the design specification.
    - It correctly looks up the selector definition by key.
    - It handles the `scopeKey` by recursively calling itself.
    - It iterates through the `tries` array, calling the appropriate DOM helper for each strategy.
    - It returns the first valid `Element` found.
    - It returns `null` if no element is found after trying all strategies.

- [x] 5. **Implement Logging for Observability**
  - **Description**: Add logging to the `resolve` function to provide traceability for both successful resolutions and failures.
  - **Dependency**: Assumes a basic logging utility (e.g., `console.log`, `console.error`) is available.
  - **Acceptance Criteria**:
    - A debug-level log is emitted upon successful resolution, specifying the key and the successful strategy.
    - An error-level log is emitted for a "selector miss," specifying the key and all attempted strategies.

- [ ] 6. **Create Unit Tests for the Resolver**
  - **Description**: Add unit tests to validate the functionality of the `resolve` function and the DOM helpers. This will require a test setup capable of mocking a DOM (e.g., using JSDOM).
  - **Acceptance Criteria**:
    - Test case for a successful resolution using the first strategy.
    - Test case for a successful resolution using a fallback strategy.
    - Test case for a failed resolution where no strategy finds a match.
    - Test case for a successful resolution using a `scopeKey`.
    - Test case for a failed resolution when the `scopeKey` itself cannot be resolved.
    - Test case for each DOM helper function.

- [x] 7. **Create Example `SelectorMap` and Usage**
  - **Description**: Create the example `oracle.json` selector map and a sample usage file to demonstrate how the `resolve` function is consumed.
  - **Files to Create/Update**:
    - `packages/selectors/oracle.json`
    - `packages/scripts/oracle/edit-page.ts` (or a similar demo file).
  - **Acceptance Criteria**: A developer can run the example and see the `resolve` function successfully finding elements based on the `oracle.json` map.

- [x] 8. **Integrate into the Main Application**
  - **Description**: Ensure the `resolve` function and its related utilities are properly exported from the `@core` package and consumed by the workflow engine.
  - **Acceptance Criteria**:
    - The `index.ts` in `packages/core/src` exports all necessary public APIs (`resolve`, `SelectorMap`, etc.).
    - The workflow engine can import and use `resolve` to find elements for its action steps.
