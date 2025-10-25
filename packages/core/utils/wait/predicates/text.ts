import { sanitizePattern, sanitizeText } from "../../sanitize";
import type { WaitPredicate, WaitPredicateResult } from "../scheduler";
import type { WaitTextMatchMode, WaitTextSnapshot } from "../types";

const DEFAULT_TEXT_MODE: WaitTextMatchMode = "contains";

export interface TextPredicateConfig {
  expected?: string;
  pattern?: RegExp;
  mode?: WaitTextMatchMode;
  sanitize?: boolean;
}

function normalizeText(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  return value.replace(/\s+/g, " ").trim();
}

function evaluateMatches(config: TextPredicateConfig, normalizedValue: string): boolean {
  const matchMode: WaitTextMatchMode = config.pattern ? "regex" : config.mode ?? DEFAULT_TEXT_MODE;

  if (matchMode === "regex") {
    const pattern = config.pattern
      ? new RegExp(config.pattern.source, config.pattern.flags)
      : config.expected
        ? new RegExp(config.expected, "i")
        : null;

    return pattern ? pattern.test(normalizedValue) : false;
  }

  const expected = normalizeText(config.expected);

  if (!expected) {
    return false;
  }

  if (matchMode === "exact") {
    return normalizedValue === expected;
  }

  return normalizedValue.includes(expected);
}

function buildSnapshot(config: TextPredicateConfig, normalizedValue: string, matches: boolean): WaitTextSnapshot {
  const matchMode: WaitTextMatchMode = config.pattern ? "regex" : config.mode ?? DEFAULT_TEXT_MODE;
  const expectedValue = normalizeText(config.expected);

  return {
    mode: matchMode,
    expected: sanitizeText(expectedValue || config.expected || null, config.sanitize) ?? undefined,
    pattern: sanitizePattern(config.pattern, config.sanitize),
    normalizedValue: sanitizeText(normalizedValue, config.sanitize),
    matches
  } satisfies WaitTextSnapshot;
}

export function evaluateTextPredicate(element: Element, config: TextPredicateConfig): WaitPredicateResult {
  const normalizedValue = normalizeText(element.textContent);
  const matches = evaluateMatches(config, normalizedValue);
  const snapshot = buildSnapshot(config, normalizedValue, matches);
  const stale = !element.isConnected;

  return {
    satisfied: matches && !stale,
    stale,
    snapshot: {
      text: snapshot
    }
  } satisfies WaitPredicateResult;
}

export function createTextPredicate(config: TextPredicateConfig): WaitPredicate {
  return ({ element }) => {
    if (!element) {
      return {
        satisfied: false,
        stale: true
      } satisfies WaitPredicateResult;
    }

    return evaluateTextPredicate(element, config);
  };
}
