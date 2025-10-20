# Design for Selector System & Resolver

## 1. High-Level Design

The Selector System is composed of two primary components:

1.  **`SelectorMap`**: A JSON object stored in dedicated files (e.g., `packages/selectors/site.json`) that provides a declarative mapping between logical, human-readable keys and an ordered list of strategies for locating a DOM element.
2.  **`resolve` function**: A core utility that takes a `SelectorMap` and a logical key, then iterates through the defined strategies to find and return a DOM element.

### Workflow

1.  A **Workflow Step** (e.g., `click("save_button")`) initiates a call to the `resolve` function with the logical key `"save_button"`.
2.  The `resolve` function looks up the `"save_button"` entry in the appropriate site's `SelectorMap`.
3.  It sequentially executes each strategy defined in the `tries` array for that key.
4.  If a strategy successfully finds an element, `resolve` immediately returns the `Element`.
5.  If a strategy fails, `resolve` logs the attempt (at a debug level) and proceeds to the next one.
6.  If a `scopeKey` is present, `resolve` first recursively calls itself to find the container element, which then becomes the root for the subsequent queries.
7.  If all strategies are exhausted without finding an element, `resolve` logs a "selector miss" error and returns `null`.

```mermaid
graph TD
    A[Workflow Step: click("save_button")] --> B{resolve(map, "save_button")};
    B --> C{Lookup "save_button" in SelectorMap};
    C --> D{Has scopeKey?};
    D -- Yes --> E{resolve(map, scopeKey)};
    E --> F[Set search root to container];
    D -- No --> G[Set search root to document];
    F --> G;
    G --> H{Try Strategy 1 (e.g., Role)};
    H -- Found --> I[Return Element];
    H -- Not Found --> J{Try Strategy 2 (e.g., data-testid)};
    J -- Found --> I;
    J -- Not Found --> K[...];
    K -- Exhausted --> L{Log "selector miss"};
    L --> M[Return null];
    I --> Z[Action continues];
    M --> Z;
```

## 2. Data Structures

### SelectorMap JSON Schema

The `SelectorMap` will adhere to the following TypeScript types, which will serve as the basis for a formal JSON schema.

```typescript
// In: packages/core/src/locators.ts

/** A single strategy for locating an element. */
export type SelectorStrategy = 
    | { type: "role"; role: string; name?: string }
    | { type: "text"; text: string; exact?: boolean }
    | { type: "dataAttr"; key: string; value?: string }
    | { type: "id"; id: string }
    | { type: "css"; css: string }
    | { type: "xpath"; xpath: string };

/** A definition for a single logical element. */
export interface SelectorDefinition {
    description?: string;
    scopeKey?: string;
    tags?: string[];
    stabilityScore?: number; // 0.0 to 1.0, provided by Inspector
    tries: SelectorStrategy[];
}

/** The complete map of logical keys to their definitions for a given site. */
export type SelectorMap = Record<string, SelectorDefinition>;

```

**Example (`packages/selectors/oracle.json`):**

```json
{
  "$schema": "./dgx.selector-map.schema.json",
  "edit_button": {
    "description": "The primary button to enter edit mode.",
    "tags": ["primary-action"],
    "stabilityScore": 0.95,
    "tries": [
      { "type": "role", "role": "button", "name": "Edit" },
      { "type": "dataAttr", "key": "data-testid", "value": "edit-entity-btn" },
      { "type": "css", "css": ".actions > button.primary" }
    ]
  },
  "notes_field": {
    "description": "Text area for notes, inside the main form.",
    "scopeKey": "main_form_container",
    "tags": ["form-field"],
    "stabilityScore": 0.9,
    "tries": [
      { "type": "role", "role": "textbox", "name": "Notes" },
      { "type": "id", "id": "note-field" }
    ]
  },
  "main_form_container": {
    "description": "The container for the main entity form.",
    "tries": [
      { "type": "id", "id": "main-form" }
    ]
  }
}
```

## 3. Core `resolve` Function Signature

The `resolve` function is the heart of the system. It will be implemented in `packages/core/src/resolve.ts`.

```typescript
// In: packages/core/src/resolve.ts

import { SelectorMap, SelectorDefinition } from './locators';

/**
 * Resolves a logical key to a DOM element using the strategies defined in a SelectorMap.
 *
 * @param map The SelectorMap for the current site.
 * @param key The logical key of the element to find.
 * @param root The root node to search within (defaults to `document`).
 * @returns The found Element, or null if all strategies fail.
 */
export function resolve(
    map: SelectorMap,
    key: string,
    root: ParentNode = document
): Element | null {
    // Implementation details follow
}
```

## 4. Component Breakdown

-   **`resolve.ts`**: Contains the main `resolve` function. It will orchestrate the lookup and strategy iteration.
-   **`locators.ts`**: Defines the TypeScript types for the `SelectorMap` and its constituent parts.
-   **`utils/dom.ts`**: Will contain the individual query functions that `resolve` delegates to (e.g., `byRole`, `byText`, `byDataAttr`). This keeps the `resolve` function clean and focused on orchestration.

### `dom.ts` Helpers

These helper functions will perform the actual DOM queries.

```typescript
// In: packages/core/src/utils/dom.ts

export function byRole(root: ParentNode, role: string, name?: string): Element | null { /* ... */ }
export function byText(root: ParentNode, text: string, exact: boolean = false): Element | null { /* ... */ }
export function byDataAttr(root: ParentNode, key: string, value?: string): Element | null { /* ... */ }
export function byId(root: ParentNode, id: string): Element | null { /* ... */ }
export function byCss(root: ParentNode, css: string): Element | null { /* ... */ }
export function byXpath(root: ParentNode, xpath: string): Element | null { /* ... */ }
```

## 5. Logic Flow for `resolve` function

1.  **Lookup Key**: Find the `SelectorDefinition` for the given `key` in the `map`. If not found, log an error and return `null`.
2.  **Handle Scope**: If `definition.scopeKey` exists:
    a. Recursively call `resolve(map, definition.scopeKey, document)` to find the container element.
    b. If the container is not found, log an error and return `null`.
    c. The found container becomes the new `root` for the current resolution.
3.  **Iterate Strategies**: Loop through the `definition.tries` array.
4.  **Delegate to Helper**: For each `strategy` object in the array, call the corresponding helper from `dom.ts` (e.g., `byRole`, `byText`) with the current `root` and strategy parameters.
5.  **Check Result**: If the helper function returns an `Element`:
    a. Log the success at a "debug" level (e.g., `[DGX] Resolved key "save_button" via role/name`).
    b. Return the `Element`.
6.  **Handle Failure**: If the helper returns `null`, continue to the next strategy.
7.  **Exhaustion**: If the loop finishes without returning an element, log a "selector miss" error with the key and all attempted strategies. Return `null`.

## 6. Observability

-   **Success Logging (Debug)**: When a key is resolved, a debug message will be logged: `[DGX] Resolved key "{key}" using {strategy.type} with params: {params}`.
-   **Failure Logging (Error)**: When a key cannot be resolved, an error message will be logged: `[DGX] Selector Miss: Failed to resolve key "{key}". Attempted strategies: [{strategy1}, {strategy2}, ...]`. The strategy descriptions will be concise strings.

This design satisfies all requirements by creating a decoupled, robust, and traceable system for locating elements declaratively.
