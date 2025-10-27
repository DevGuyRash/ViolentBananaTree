import { historyManager } from './history';
import { observerManager } from './observer-manager';
import { Predicate } from './types';

const registry = new Map<string, Predicate>();

export const PredicateRegistry = {
  register(name: string, predicate: Predicate) {
    if (registry.has(name)) {
      console.warn(`[DGX] Predicate with name "${name}" is already registered. It will be overwritten.`);
    }
    registry.set(name, predicate);
  },

  async execute(name: string, options: any) {
    const predicate = registry.get(name);
    if (!predicate) {
      throw new Error(`[DGX] Predicate with name "${name}" is not registered.`);
    }
    // TODO: Implement error sanitization and history snapshots.
    try {
      const satisfied = await predicate(options);
      historyManager.add({ predicateName: name, options, satisfied });
      return {
        satisfied,
        history: historyManager.getHistory(),
      };
    } catch (e: any) {
      const sanitizedError = `[DGX] Predicate "${name}" failed with error: ${e.message}`;
      historyManager.add({ predicateName: name, options, satisfied: false, error: sanitizedError });
      return {
        satisfied: false,
        history: historyManager.getHistory(),
        error: sanitizedError,
      };
    }
  },

  cleanup() {
    observerManager.cleanup();
  },
};
