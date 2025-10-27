# Requirements

## 1. Predicate Registry

### 1.1. Functional Requirements

- **1.1.1. Registration**: The system SHALL provide a registry for predicate functions.
- **1.1.2. Execution**: The registry SHALL be able to execute a registered predicate by name.
- **1.1.3. Modes**: The registry SHALL support predicates for different modes:
    - `settled`: The page is stable (no mutations).
    - `growth`: A list has grown in size.
    - `stable`: A specific element is stable (no mutations).
- **1.1.4. DOM Stability Measurement**: The registry SHALL provide a mechanism to measure DOM stability using `MutationObserver`.
- **1.1.5. Error Sanitization**: The registry SHALL sanitize errors from predicates to prevent leaking sensitive information.
- **1.1.6. Typed Outcomes**: The registry SHALL expose typed outcomes for predicates.
- **1.1.7. History Snapshots**: The registry SHALL provide history snapshots of predicate executions.
- **1.1.8. Cleanup**: The registry SHALL provide a mechanism to clean up observers.

### 1.2. Non-Functional Requirements

- **1.2.1. Performance**: Predicate execution SHOULD be performant and not block the main thread.
- **1.2.2. Reusability**: Predicates SHOULD be reusable across different workflows.
- **1.2.3. Testability**: The predicate registry and predicates SHALL be testable.
