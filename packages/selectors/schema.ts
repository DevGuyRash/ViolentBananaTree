import {
  SelectorEntry,
  SelectorEntryMetadata,
  SelectorMap,
  SelectorStrategy,
  SelectorStrategyType,
  SelectorTry,
  SelectorTryMetadata,
  getStrategyPriority,
  isSelectorStrategyType
} from "./types";

export type ValidationError = {
  path: string;
  message: string;
};

type ValidationContext = {
  errors: ValidationError[];
};

type PendingScopeCheck = {
  key: string;
  scopeKey: string;
  path: string;
};

export class SelectorSchemaError extends Error {
  readonly issues: readonly ValidationError[];

  constructor(message: string, issues: readonly ValidationError[]) {
    super(message);
    this.name = "SelectorSchemaError";
    this.issues = issues;
  }
}

function pushError(ctx: ValidationContext, path: string, message: string): void {
  ctx.errors.push({ path, message });
}

function assertArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function assertRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateStrategy(
  value: unknown,
  ctx: ValidationContext,
  path: string,
  previousPriority: number | null
): SelectorTry | null {
  if (!assertRecord(value)) {
    pushError(ctx, path, "Strategy must be an object");
    return null;
  }

  const typeValue = value.type;
  if (!isSelectorStrategyType(typeValue)) {
    pushError(ctx, `${path}.type`, `Invalid strategy type: ${String(typeValue)}`);
    return null;
  }

  const priority = getStrategyPriority(typeValue);
  if (previousPriority !== null && priority < previousPriority) {
    pushError(ctx, path, "Strategies must follow canonical order");
  }

  const strategyPath = `${path}<${typeValue}>`;
  switch (typeValue) {
    case "role": {
      if (!isNonEmptyString(value.role)) {
        pushError(ctx, `${strategyPath}.role`, "Role strategy requires role");
      }
      break;
    }
    case "name": {
      if (!isNonEmptyString(value.name)) {
        pushError(ctx, `${strategyPath}.name`, "Name strategy requires name");
      }
      break;
    }
    case "label": {
      if (!isNonEmptyString(value.label)) {
        pushError(ctx, `${strategyPath}.label`, "Label strategy requires label");
      }
      break;
    }
    case "text": {
      if (!isNonEmptyString(value.text)) {
        pushError(ctx, `${strategyPath}.text`, "Text strategy requires text");
      }
      break;
    }
    case "dataAttr": {
      if (!isNonEmptyString(value.attribute)) {
        pushError(ctx, `${strategyPath}.attribute`, "dataAttr strategy requires attribute");
      }
      break;
    }
    case "testId": {
      if (!isNonEmptyString(value.testId)) {
        pushError(ctx, `${strategyPath}.testId`, "testId strategy requires testId");
      }
      break;
    }
    case "css": {
      if (!isNonEmptyString(value.selector)) {
        pushError(ctx, `${strategyPath}.selector`, "CSS strategy requires selector");
      }
      break;
    }
    case "xpath": {
      if (!isNonEmptyString(value.expression)) {
        pushError(ctx, `${strategyPath}.expression`, "XPath strategy requires expression");
      }
      break;
    }
  }

  validateStrategyMetadata(value, ctx, strategyPath);

  return value as SelectorTry;
}

function validateStrategyMetadata(
  value: Record<string, unknown>,
  ctx: ValidationContext,
  path: string
): asserts value is SelectorStrategy & SelectorTryMetadata {
  if ("stabilityScore" in value && typeof value.stabilityScore !== "number") {
    pushError(ctx, `${path}.stabilityScore`, "stabilityScore must be a number");
  }

  if ("uniqueInScope" in value && typeof value.uniqueInScope !== "boolean") {
    pushError(ctx, `${path}.uniqueInScope`, "uniqueInScope must be a boolean");
  }

  if ("tags" in value && !assertArray(value.tags)) {
    pushError(ctx, `${path}.tags`, "tags must be an array of strings");
  } else if (Array.isArray(value.tags)) {
    value.tags.forEach((tag, index) => {
      if (!isNonEmptyString(tag)) {
        pushError(ctx, `${path}.tags[${index}]`, "tags must contain strings");
      }
    });
  }

  if ("notes" in value && typeof value.notes !== "string") {
    pushError(ctx, `${path}.notes`, "notes must be a string");
  }

  if ("lastVerifiedAt" in value && typeof value.lastVerifiedAt !== "string") {
    pushError(ctx, `${path}.lastVerifiedAt`, "lastVerifiedAt must be an ISO string");
  }
}

function validateEntryMetadata(
  value: Record<string, unknown>,
  ctx: ValidationContext,
  path: string
): void {
  if ("description" in value && typeof value.description !== "string") {
    pushError(ctx, `${path}.description`, "description must be a string");
  }

  if ("scopeKey" in value && typeof value.scopeKey !== "string") {
    pushError(ctx, `${path}.scopeKey`, "scopeKey must be a string");
  }

  if ("tags" in value && !assertArray(value.tags)) {
    pushError(ctx, `${path}.tags`, "tags must be an array of strings");
  } else if (Array.isArray(value.tags)) {
    value.tags.forEach((tag, index) => {
      if (!isNonEmptyString(tag)) {
        pushError(ctx, `${path}.tags[${index}]`, "tags must contain strings");
      }
    });
  }

  if ("stabilityScore" in value && typeof value.stabilityScore !== "number") {
    pushError(ctx, `${path}.stabilityScore`, "stabilityScore must be a number");
  }

  if ("notes" in value && typeof value.notes !== "string") {
    pushError(ctx, `${path}.notes`, "notes must be a string");
  }

  if ("lastUpdatedAt" in value && typeof value.lastUpdatedAt !== "string") {
    pushError(ctx, `${path}.lastUpdatedAt`, "lastUpdatedAt must be an ISO string");
  }
}

function validateSelectorEntry(
  value: unknown,
  ctx: ValidationContext,
  path: string,
  key: string,
  pendingScopes: PendingScopeCheck[]
): SelectorEntry | null {
  if (!assertRecord(value)) {
    pushError(ctx, path, "Entry must be an object");
    return null;
  }

  validateEntryMetadata(value, ctx, path);

  if (!assertArray(value.tries)) {
    pushError(ctx, `${path}.tries`, "tries must be an array");
    return null;
  }

  let previousPriority: number | null = null;
  const validatedTries: SelectorTry[] = [];

  value.tries.forEach((tryValue, index) => {
    const tryPath = `${path}.tries[${index}]`;
    const validatedTry = validateStrategy(tryValue, ctx, tryPath, previousPriority);
    if (validatedTry) {
      previousPriority = getStrategyPriority(validatedTry.type);
      validatedTries.push(validatedTry);
    }
  });

  if (validatedTries.length === 0) {
    pushError(ctx, `${path}.tries`, "tries must contain at least one strategy");
  }

  if (isNonEmptyString(value.scopeKey)) {
    if (value.scopeKey === key) {
      pushError(ctx, `${path}.scopeKey`, "scopeKey cannot reference the same logical key");
    } else {
      pendingScopes.push({ key, scopeKey: value.scopeKey, path: `${path}.scopeKey` });
    }
  }

  const entry: SelectorEntry = {
    ...(value as SelectorEntryMetadata & Record<string, unknown>),
    tries: validatedTries
  };

  return entry;
}

export function validateSelectorMap(value: unknown): SelectorMap {
  const ctx: ValidationContext = { errors: [] };
  const pendingScopes: PendingScopeCheck[] = [];

  if (!assertRecord(value)) {
    throw new SelectorSchemaError("Selector map must be an object", [
      { path: "<root>", message: "Expected object" }
    ]);
  }

  const entries: SelectorMap = {};

  Object.keys(value).forEach((key) => {
    const path = `map['${key}']`;
    if (!isNonEmptyString(key)) {
      pushError(ctx, path, "Selector key must be a non-empty string");
      return;
    }

    const entryValue = value[key];
    const validated = validateSelectorEntry(entryValue, ctx, path, key, pendingScopes);
    if (validated) {
      entries[key] = validated;
    }
  });

  pendingScopes.forEach(({ scopeKey, path }) => {
    if (!(scopeKey in entries)) {
      pushError(ctx, path, `Referenced scopeKey '${scopeKey}' missing from map`);
    }
  });

  if (ctx.errors.length > 0) {
    throw new SelectorSchemaError("Selector map validation failed", ctx.errors);
  }

  return entries;
}

export function loadSelectorMap(jsonText: string): SelectorMap {
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    return validateSelectorMap(parsed);
  } catch (error) {
    if (error instanceof SelectorSchemaError) {
      throw error;
    }

    throw new SelectorSchemaError("Failed to parse selector map JSON", [
      { path: "<root>", message: (error as Error).message }
    ]);
  }
}

export function isSelectorMap(value: unknown): value is SelectorMap {
  try {
    validateSelectorMap(value);
    return true;
  } catch {
    return false;
  }
}

export type {
  SelectorEntry,
  SelectorEntryMetadata,
  SelectorMap,
  SelectorStrategy,
  SelectorStrategyType,
  SelectorTry,
  SelectorTryMetadata
};
