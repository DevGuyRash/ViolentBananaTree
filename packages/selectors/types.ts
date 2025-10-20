export const STRATEGY_ORDER = [
  "role",
  "name",
  "label",
  "text",
  "dataAttr",
  "testId",
  "css",
  "xpath"
] as const;

export type SelectorStrategyType = typeof STRATEGY_ORDER[number];

const STRATEGY_PRIORITY: Readonly<Record<SelectorStrategyType, number>> = {
  role: 0,
  name: 1,
  label: 2,
  text: 3,
  dataAttr: 4,
  testId: 5,
  css: 6,
  xpath: 7
};

const STRATEGY_TYPE_SET = new Set<SelectorStrategyType>(STRATEGY_ORDER);

export function isSelectorStrategyType(value: unknown): value is SelectorStrategyType {
  return typeof value === "string" && STRATEGY_TYPE_SET.has(value as SelectorStrategyType);
}

export function getStrategyPriority(type: SelectorStrategyType): number {
  return STRATEGY_PRIORITY[type];
}

type WithExtras<T extends object> = T & Record<string, unknown>;

export type RoleStrategy = WithExtras<{
  type: "role";
  role: string;
  name?: string;
  label?: string;
  text?: string;
}>;

export type NameStrategy = WithExtras<{
  type: "name";
  name: string;
}>;

export type LabelStrategy = WithExtras<{
  type: "label";
  label: string;
  caseSensitive?: boolean;
}>;

export type TextStrategy = WithExtras<{
  type: "text";
  text: string;
  exact?: boolean;
  caseSensitive?: boolean;
  normalizeWhitespace?: boolean;
}>;

export type DataAttrStrategy = WithExtras<{
  type: "dataAttr";
  attribute: string;
  value?: string;
}>;

export type TestIdStrategy = WithExtras<{
  type: "testId";
  testId: string;
  attribute?: string;
}>;

export type CssStrategy = WithExtras<{
  type: "css";
  selector: string;
}>;

export type XpathStrategy = WithExtras<{
  type: "xpath";
  expression: string;
}>;

export type SelectorStrategy =
  | RoleStrategy
  | NameStrategy
  | LabelStrategy
  | TextStrategy
  | DataAttrStrategy
  | TestIdStrategy
  | CssStrategy
  | XpathStrategy;

export interface SelectorTryMetadata {
  stabilityScore?: number;
  uniqueInScope?: boolean;
  tags?: string[];
  notes?: string;
  lastVerifiedAt?: string;
}

export type SelectorTry = WithExtras<SelectorStrategy & SelectorTryMetadata>;

export interface SelectorEntryMetadata {
  description?: string;
  scopeKey?: string;
  tags?: string[];
  stabilityScore?: number;
  notes?: string;
  lastUpdatedAt?: string;
}

export type SelectorEntry = WithExtras<SelectorEntryMetadata & { tries: SelectorTry[] }>;

export type SelectorMap = Record<string, SelectorEntry>;

export type SelectorKey = keyof SelectorMap & string;
