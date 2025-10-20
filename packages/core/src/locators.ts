
export type SelectorStrategy =
  | { type: "role"; role: string; name?: string }
  | { type: "text"; text: string; exact?: boolean }
  | { type: "dataAttr"; key: string; value?: string }
  | { type: "id"; id: string }
  | { type: "css"; css: string }
  | { type: "xpath"; xpath: string };

export interface SelectorDefinition {
  description?: string;
  scopeKey?: string;
  tags?: string[];
  stabilityScore?: number;
  tries: SelectorStrategy[];
}

export type SelectorMap = Record<string, SelectorDefinition>;

