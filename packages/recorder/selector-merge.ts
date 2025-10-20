import {
  getStrategyPriority,
  type SelectorEntry,
  type SelectorEntryMetadata,
  type SelectorMap,
  type SelectorStrategy,
  type SelectorStrategyType,
  type SelectorTry,
  type SelectorTryMetadata
} from "../selectors/types";

type PartialSelectorEntry = SelectorEntryMetadata & { tries: SelectorTry[] };

const STRATEGY_METADATA_KEYS = new Set<keyof SelectorTryMetadata>([
  "stabilityScore",
  "uniqueInScope",
  "tags",
  "notes",
  "lastVerifiedAt"
]);

function cloneTry(source: SelectorTry): SelectorTry {
  const cloned: SelectorTry = { ...source };
  if (source.tags) {
    cloned.tags = [...source.tags];
  }
  return cloned;
}

function cloneEntry(source: SelectorEntry): SelectorEntry {
  const cloned: SelectorEntry = {
    ...source,
    tries: source.tries.map(cloneTry)
  };

  if (source.tags) {
    cloned.tags = [...source.tags];
  }

  return cloned;
}

function toIdentity(strategy: SelectorStrategy): string {
  const base: Record<string, unknown> = { type: strategy.type };

  Object.keys(strategy)
    .sort()
    .forEach((key) => {
      if (key === "type" || STRATEGY_METADATA_KEYS.has(key as keyof SelectorTryMetadata)) {
        return;
      }

      const value = (strategy as Record<string, unknown>)[key];
      if (value !== undefined) {
        base[key] = value;
      }
    });

  return JSON.stringify(base);
}

function mergeTags(existing?: string[], incoming?: string[]): string[] | undefined {
  if (!existing && !incoming) {
    return undefined;
  }

  const seen = new Set<string>();
  const result: string[] = [];

  const push = (values?: string[]) => {
    values?.forEach((value) => {
      if (!seen.has(value)) {
        seen.add(value);
        result.push(value);
      }
    });
  };

  push(existing);
  push(incoming);

  return result.length > 0 ? result : undefined;
}

function mergeNotes(existing?: string, incoming?: string): string | undefined {
  if (!existing) {
    return incoming;
  }

  if (!incoming || incoming.trim().length === 0) {
    return existing;
  }

  if (existing.includes(incoming)) {
    return existing;
  }

  if (incoming.includes(existing)) {
    return incoming;
  }

  return `${existing}\n${incoming}`;
}

function mergeTryMetadata(
  existing: SelectorTryMetadata,
  incoming: SelectorTryMetadata
): SelectorTryMetadata {
  const merged: SelectorTryMetadata = { ...existing };

  if (incoming.stabilityScore !== undefined) {
    merged.stabilityScore = incoming.stabilityScore;
  }

  if (incoming.uniqueInScope !== undefined) {
    merged.uniqueInScope = incoming.uniqueInScope;
  }

  merged.tags = mergeTags(existing.tags, incoming.tags);
  merged.notes = mergeNotes(existing.notes, incoming.notes);

  if (incoming.lastVerifiedAt) {
    merged.lastVerifiedAt = incoming.lastVerifiedAt;
  }

  return merged;
}

function mergeEntryMetadata(
  existing: SelectorEntryMetadata,
  incoming: SelectorEntryMetadata
): SelectorEntryMetadata {
  const merged: SelectorEntryMetadata = { ...existing };

  if (incoming.description) {
    merged.description = incoming.description;
  }

  if (incoming.scopeKey) {
    merged.scopeKey = incoming.scopeKey;
  }

  if (incoming.stabilityScore !== undefined) {
    merged.stabilityScore = incoming.stabilityScore;
  }

  merged.tags = mergeTags(existing.tags, incoming.tags);
  merged.notes = mergeNotes(existing.notes, incoming.notes);

  if (incoming.lastUpdatedAt) {
    merged.lastUpdatedAt = incoming.lastUpdatedAt;
  }

  return merged;
}

function mergeTry(existing: SelectorTry, incoming: SelectorTry): SelectorTry {
  const merged: SelectorTry = { ...existing };

  Object.keys(incoming).forEach((key) => {
    if (key === "type" || STRATEGY_METADATA_KEYS.has(key as keyof SelectorTryMetadata)) {
      return;
    }

    const value = (incoming as Record<string, unknown>)[key];
    if (value !== undefined) {
      (merged as Record<string, unknown>)[key] = value;
    }
  });

  const mergedMetadata = mergeTryMetadata(existing, incoming);
  merged.stabilityScore = mergedMetadata.stabilityScore;
  merged.uniqueInScope = mergedMetadata.uniqueInScope;
  merged.tags = mergedMetadata.tags;
  merged.notes = mergedMetadata.notes;
  merged.lastVerifiedAt = mergedMetadata.lastVerifiedAt;

  return merged;
}

function insertByPriority(
  order: string[],
  store: Map<string, SelectorTry>,
  identity: string,
  value: SelectorTry
): void {
  const priority = getStrategyPriority(value.type);

  for (let index = 0; index < order.length; index += 1) {
    const current = store.get(order[index]);
    if (!current) {
      continue;
    }

    const currentPriority = getStrategyPriority(current.type);
    if (priority < currentPriority) {
      order.splice(index, 0, identity);
      store.set(identity, value);
      return;
    }
  }

  order.push(identity);
  store.set(identity, value);
}

function mergeTries(existing: SelectorTry[], incoming: SelectorTry[]): SelectorTry[] {
  const store = new Map<string, SelectorTry>();
  const order: string[] = [];

  existing.forEach((strategy) => {
    const identity = toIdentity(strategy);
    order.push(identity);
    store.set(identity, cloneTry(strategy));
  });

  incoming.forEach((strategy) => {
    const identity = toIdentity(strategy);
    const current = store.get(identity);

    if (current) {
      store.set(identity, mergeTry(current, cloneTry(strategy)));
      return;
    }

    insertByPriority(order, store, identity, cloneTry(strategy));
  });

  return order.map((identity) => store.get(identity)!).filter(Boolean);
}

export function mergeSelectorEntry(
  existing: SelectorEntry | undefined,
  incoming: PartialSelectorEntry
): SelectorEntry {
  if (!existing) {
    return {
      ...incoming,
      tries: incoming.tries.map(cloneTry),
      tags: incoming.tags ? [...incoming.tags] : incoming.tags
    } satisfies SelectorEntry;
  }

  const base = cloneEntry(existing);
  const metadata = mergeEntryMetadata(base, incoming);

  return {
    ...metadata,
    tries: mergeTries(base.tries, incoming.tries)
  } satisfies SelectorEntry;
}

export function mergeSelectorMap(
  existing: SelectorMap,
  updates: Record<string, PartialSelectorEntry>
): SelectorMap {
  const result: SelectorMap = {};

  Object.keys(existing).forEach((key) => {
    result[key] = cloneEntry(existing[key]);
  });

  Object.keys(updates).forEach((key) => {
    const incoming = updates[key];
    result[key] = mergeSelectorEntry(existing[key], incoming);
  });

  return result;
}

export type SelectorMergeUpdate = {
  key: string;
  entry: PartialSelectorEntry;
};

export function applySelectorUpdates(
  existing: SelectorMap,
  updates: SelectorMergeUpdate[]
): SelectorMap {
  return updates.reduce((map, update) => {
    return {
      ...map,
      [update.key]: mergeSelectorEntry(map[update.key], update.entry)
    };
  },
  Object.keys(existing).reduce<SelectorMap>((acc, key) => {
    acc[key] = cloneEntry(existing[key]);
    return acc;
  }, {} as SelectorMap));
}

export function getStrategyInsertIndex(
  tries: SelectorTry[],
  type: SelectorStrategyType
): number {
  const targetPriority = getStrategyPriority(type);
  for (let index = 0; index < tries.length; index += 1) {
    if (getStrategyPriority(tries[index].type) > targetPriority) {
      return index;
    }
  }

  return tries.length;
}
