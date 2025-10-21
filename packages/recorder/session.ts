import type { SelectorEntry, SelectorMap } from "../selectors/types";
import {
  buildSelectorOnboardingTooltip,
  type RecorderOnboardingOptions,
  type RecorderOnboardingTooltip
} from "./onboarding";

export type RecorderOnboardingStep = {
  key: string;
  tooltip: RecorderOnboardingTooltip;
};

function lookup(map: SelectorMap, key: string): SelectorEntry | undefined {
  return key in map ? map[key] : undefined;
}

export function buildOnboardingStep(
  map: SelectorMap,
  key: string,
  options?: RecorderOnboardingOptions
): RecorderOnboardingStep {
  const entry = lookup(map, key);
  return {
    key,
    tooltip: buildSelectorOnboardingTooltip(entry, options)
  };
}

export function buildOnboardingSequence(
  map: SelectorMap,
  keys: string[],
  options?: RecorderOnboardingOptions
): RecorderOnboardingStep[] {
  return keys.map((key) => buildOnboardingStep(map, key, options));
}
