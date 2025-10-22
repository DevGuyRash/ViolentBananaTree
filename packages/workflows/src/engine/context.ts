import type { WorkflowContext, WorkflowContextSnapshot } from "../types";

const MANAGER_REF = Symbol.for("dgx/workflows/context-manager");

export interface ContextSetOptions {
  ttlMs?: number;
}

export interface WorkflowContextScope {
  readonly id: string;
  readonly label?: string;
  get<T = unknown>(key: string): T | undefined;
  set(key: string, value: unknown, options?: ContextSetOptions): void;
  delete(key: string): void;
  commit(): void;
  rollback(): void;
}

export interface WorkflowContextManager {
  readonly context: WorkflowContext;
  get<T = unknown>(key: string): T | undefined;
  set(key: string, value: unknown, options?: ContextSetOptions): void;
  delete(key: string): void;
  snapshot(): WorkflowContextSnapshot;
  pruneExpired(): void;
  pushScope(label?: string): WorkflowContextScope;
  withScope<T>(fn: (scope: WorkflowContextScope) => T | Promise<T>, label?: string): Promise<T>;
}

type ScopeEntry = {
  id: string;
  label?: string;
  values: Map<string, unknown>;
  deletes: Set<string>;
  ttl: Map<string, number>;
  closed: boolean;
};

type ManagedContext = WorkflowContext & { [MANAGER_REF]?: WorkflowContextManagerImpl };

export function createContextManager(base: WorkflowContext): WorkflowContextManager {
  const existing = getContextManager(base);

  if (existing) {
    return existing;
  }

  return new WorkflowContextManagerImpl(base);
}

export function getContextManager(context: WorkflowContext): WorkflowContextManager | undefined {
  return (context as ManagedContext)[MANAGER_REF];
}

class WorkflowContextManagerImpl implements WorkflowContextManager {
  #base: WorkflowContext;
  #ttl = new Map<string, number>();
  #scopes: ScopeEntry[] = [];
  #idCounter = 0;
  readonly context: WorkflowContext;

  constructor(base: WorkflowContext) {
    this.#base = base;

    Object.defineProperty(base, MANAGER_REF, {
      value: this,
      writable: false,
      enumerable: false,
      configurable: true
    });

    const proxy: ManagedContext = {
      get: (key) => this.get(key),
      set: (key, value) => this.set(key, value),
      delete: (key) => this.delete(key),
      merge: (values) => {
        Object.entries(values).forEach(([key, value]) => {
          this.set(key, value);
        });
      },
      snapshot: () => this.snapshot()
    };

    Object.defineProperty(proxy, MANAGER_REF, {
      value: this,
      writable: false,
      enumerable: false,
      configurable: true
    });

    this.context = proxy;
  }

  get<T = unknown>(key: string): T | undefined {
    this.pruneExpired();
    const resolution = this.#resolveValue(key);
    return resolution.found ? (resolution.value as T | undefined) : undefined;
  }

  set(key: string, value: unknown, options?: ContextSetOptions): void {
    this.#setInternal(this.#currentScope(), key, value, options);
  }

  delete(key: string): void {
    this.#deleteInternal(this.#currentScope(), key);
  }

  snapshot(): WorkflowContextSnapshot {
    this.pruneExpired();

    const baseSnapshot = this.#base.snapshot();
    const snapshot: WorkflowContextSnapshot = { ...baseSnapshot };

    this.#scopes.forEach((scope) => {
      scope.deletes.forEach((key) => {
        delete snapshot[key];
      });

      scope.values.forEach((value, key) => {
        if (!scope.deletes.has(key)) {
          snapshot[key] = value;
        }
      });
    });

    return snapshot;
  }

  pruneExpired(): void {
    const now = Date.now();

    for (const [key, expiresAt] of this.#ttl) {
      if (expiresAt <= now) {
        this.#ttl.delete(key);
        this.#base.delete(key);
      }
    }

    this.#scopes.forEach((scope) => {
      for (const [key, expiresAt] of scope.ttl) {
        if (expiresAt <= now) {
          scope.ttl.delete(key);
          scope.values.delete(key);
          scope.deletes.add(key);
        }
      }
    });
  }

  pushScope(label?: string): WorkflowContextScope {
    const scope = this.#createScope(label);
    this.#scopes.push(scope);
    return new WorkflowContextScopeImpl(this, scope);
  }

  async withScope<T>(fn: (scope: WorkflowContextScope) => T | Promise<T>, label?: string): Promise<T> {
    const scope = this.pushScope(label);

    try {
      const result = await fn(scope);
      scope.commit();
      return result;
    } catch (error) {
      scope.rollback();
      throw error;
    }
  }

  #createScope(label?: string): ScopeEntry {
    this.pruneExpired();

    return {
      id: `scope_${++this.#idCounter}`,
      label,
      values: new Map(),
      deletes: new Set(),
      ttl: new Map(),
      closed: false
    };
  }

  #currentScope(): ScopeEntry | null {
    if (this.#scopes.length === 0) {
      return null;
    }

    return this.#scopes[this.#scopes.length - 1];
  }

  #setInternal(scope: ScopeEntry | null, key: string, value: unknown, options?: ContextSetOptions): void {
    const expiresAt = resolveExpiry(options?.ttlMs);

    if (scope) {
      scope.values.set(key, value);
      scope.deletes.delete(key);

      if (typeof expiresAt === "number") {
        scope.ttl.set(key, expiresAt);
      } else {
        scope.ttl.delete(key);
      }

      return;
    }

    this.#base.set(key, value);

    if (typeof expiresAt === "number") {
      this.#ttl.set(key, expiresAt);
    } else {
      this.#ttl.delete(key);
    }
  }

  #deleteInternal(scope: ScopeEntry | null, key: string): void {
    if (scope) {
      scope.values.delete(key);
      scope.ttl.delete(key);
      scope.deletes.add(key);
      return;
    }

    this.#base.delete(key);
    this.#ttl.delete(key);
  }

  #closeScope(entry: ScopeEntry, commit: boolean): void {
    const top = this.#currentScope();

    if (top !== entry) {
      throw new Error("Context scope closure out of order");
    }

    entry.closed = true;
    this.#scopes.pop();

    if (!commit) {
      return;
    }

    const parent = this.#currentScope();

    if (parent) {
      entry.deletes.forEach((key) => {
        parent.values.delete(key);
        parent.ttl.delete(key);
        parent.deletes.add(key);
      });

      entry.values.forEach((value, key) => {
        if (entry.deletes.has(key)) {
          return;
        }

        parent.values.set(key, value);

        if (entry.ttl.has(key)) {
          parent.ttl.set(key, entry.ttl.get(key)!);
        } else {
          parent.ttl.delete(key);
        }

        parent.deletes.delete(key);
      });

      return;
    }

    entry.deletes.forEach((key) => {
      this.#base.delete(key);
      this.#ttl.delete(key);
    });

    entry.values.forEach((value, key) => {
      if (entry.deletes.has(key)) {
        return;
      }

      this.#base.set(key, value);

      if (entry.ttl.has(key)) {
        this.#ttl.set(key, entry.ttl.get(key)!);
      } else {
        this.#ttl.delete(key);
      }
    });
  }

  #resolveValue(key: string): { found: boolean; value?: unknown } {
    for (let index = this.#scopes.length - 1; index >= 0; index -= 1) {
      const scope = this.#scopes[index];

      if (scope.deletes.has(key)) {
        return { found: true, value: undefined };
      }

      if (scope.values.has(key)) {
        return { found: true, value: scope.values.get(key) };
      }
    }

    const value = this.#base.get(key);

    if (typeof value === "undefined") {
      return { found: false };
    }

    const expiresAt = this.#ttl.get(key);

    if (typeof expiresAt === "number" && expiresAt <= Date.now()) {
      this.#ttl.delete(key);
      this.#base.delete(key);
      return { found: false };
    }

    return { found: true, value };
  }

  #getFromScope(scope: ScopeEntry, key: string): { found: boolean; value?: unknown } {
    if (scope.deletes.has(key)) {
      return { found: true, value: undefined };
    }

    if (scope.values.has(key)) {
      const expiresAt = scope.ttl.get(key);

      if (typeof expiresAt === "number" && expiresAt <= Date.now()) {
        scope.ttl.delete(key);
        scope.values.delete(key);
        scope.deletes.add(key);
        return { found: true, value: undefined };
      }

      return { found: true, value: scope.values.get(key) };
    }

    return { found: false };
  }

  scopeSet(entry: ScopeEntry, key: string, value: unknown, options?: ContextSetOptions): void {
    this.#assertActive(entry);
    this.#setInternal(entry, key, value, options);
  }

  scopeDelete(entry: ScopeEntry, key: string): void {
    this.#assertActive(entry);
    this.#deleteInternal(entry, key);
  }

  scopeGet(entry: ScopeEntry, key: string): unknown {
    return this.#resolveWithinScope(entry, key).value;
  }

  commitScope(entry: ScopeEntry): void {
    this.#closeScope(entry, true);
  }

  rollbackScope(entry: ScopeEntry): void {
    this.#closeScope(entry, false);
  }

  #assertActive(entry: ScopeEntry): void {
    if (entry.closed) {
      throw new Error("Workflow context scope already closed");
    }
  }

  #resolveWithinScope(entry: ScopeEntry, key: string): { found: boolean; value?: unknown } {
    this.#assertActive(entry);

    const local = this.#getFromScope(entry, key);

    if (local.found) {
      return local;
    }

    const index = this.#scopes.indexOf(entry);

    if (index === -1) {
      return this.#resolveValue(key);
    }

    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const scope = this.#scopes[cursor];
      const fromScope = this.#getFromScope(scope, key);

      if (fromScope.found) {
        return fromScope;
      }
    }

    const baseValue = this.#base.get(key);

    if (typeof baseValue === "undefined") {
      return { found: false };
    }

    const expiresAt = this.#ttl.get(key);

    if (typeof expiresAt === "number" && expiresAt <= Date.now()) {
      this.#ttl.delete(key);
      this.#base.delete(key);
      return { found: false };
    }

    return { found: true, value: baseValue };
  }

}

class WorkflowContextScopeImpl implements WorkflowContextScope {
  readonly id: string;
  readonly label?: string;
  #manager: WorkflowContextManagerImpl;
  #entry: ScopeEntry;

  constructor(manager: WorkflowContextManagerImpl, entry: ScopeEntry) {
    this.#manager = manager;
    this.#entry = entry;
    this.id = entry.id;
    this.label = entry.label;
  }

  get<T = unknown>(key: string): T | undefined {
    return this.#manager.scopeGet(this.#entry, key) as T | undefined;
  }

  set(key: string, value: unknown, options?: ContextSetOptions): void {
    this.#manager.scopeSet(this.#entry, key, value, options);
  }

  delete(key: string): void {
    this.#manager.scopeDelete(this.#entry, key);
  }

  commit(): void {
    this.#manager.commitScope(this.#entry);
  }

  rollback(): void {
    this.#manager.rollbackScope(this.#entry);
  }
}

function resolveExpiry(ttlMs: number | undefined): number | undefined {
  if (typeof ttlMs !== "number" || !Number.isFinite(ttlMs) || ttlMs <= 0) {
    return undefined;
  }

  return Date.now() + ttlMs;
}
