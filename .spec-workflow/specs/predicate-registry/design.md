# Design

## 1. Predicate Registry

### 1.1. Architecture

The predicate registry will be a singleton class that manages the lifecycle of predicates. It will use a `Map` to store registered predicates.

### 1.2. API

```typescript
interface Predicate {
  (options: any): Promise<boolean>;
}

interface PredicateOutcome {
  satisfied: boolean;
  history: any[];
}

class PredicateRegistry {
  public static register(name: string, predicate: Predicate): void;
  public static execute(name: string, options: any): Promise<PredicateOutcome>;
  public static cleanup(): void;
}
```

### 1.3. Predicate Modes

#### 1.3.1. `settled`

This predicate will use a `MutationObserver` to monitor the `document.body` for mutations. It will resolve to `true` when no mutations have been observed for a configurable amount of time.

#### 1.3.2. `growth`

This predicate will use a `MutationObserver` to monitor a specific element for mutations. It will resolve to `true` when the number of children of the element has increased.

#### 1.3.3. `stable`

This predicate will use a `MutationObserver` to monitor a specific element for mutations. It will resolve to `true` when no mutations have been observed for a configurable amount of time.

### 1.4. Error Handling

Predicate errors will be caught and sanitized to prevent leaking sensitive information. The sanitized error message will be returned in the `PredicateOutcome`.
