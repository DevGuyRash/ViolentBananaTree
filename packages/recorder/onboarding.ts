import { STRATEGY_ORDER, type SelectorEntry, type SelectorTry } from "../selectors/types";
import {
  composeHudDescription,
  formatHudStabilityScore,
  resolveHudTerminology,
  type HudLocalize,
  type HudTerminology
} from "../menu/hud";

export type RecorderOnboardingLocalizationKey =
  | "recorder.onboarding.headline"
  | "recorder.onboarding.message"
  | "recorder.onboarding.stability.note"
  | "recorder.onboarding.scope.none"
  | "recorder.onboarding.scope.withKey"
  | "recorder.onboarding.scope.note.withKey"
  | "recorder.onboarding.scope.note.none"
  | "recorder.onboarding.degradation.note"
  | "recorder.onboarding.stability.empty";

export type RecorderOnboardingLocalize = (
  key: RecorderOnboardingLocalizationKey,
  fallback: string
) => string;

export type RecorderOnboardingSection = {
  title: string;
  body: string;
};

export type RecorderOnboardingTooltip = {
  headline: string;
  message: string;
  sections: RecorderOnboardingSection[];
};

export type RecorderOnboardingOptions = {
  localize?: RecorderOnboardingLocalize;
  hudLocalize?: HudLocalize;
};

const DEFAULT_LOCALIZE: RecorderOnboardingLocalize = (_key, fallback) => fallback;

type TerminologyBundle = HudTerminology & {
  stabilityNote: string;
  scopeWithKey: (key: string) => string;
  scopeWithoutKey: string;
  scopeNote: (key?: string) => string;
  degradationNote: (strategyOrder: string) => string;
  stabilityEmpty: string;
};

function resolveTerminology(options: RecorderOnboardingOptions | undefined): TerminologyBundle {
  const hudTerminology = resolveHudTerminology(options?.hudLocalize);
  const localize = options?.localize ?? DEFAULT_LOCALIZE;

  return {
    ...hudTerminology,
    stabilityNote: localize(
      "recorder.onboarding.stability.note",
      "Higher scores mean the strategy is more likely to survive DOM changes."
    ),
    scopeWithKey: (key: string) =>
      localize(
        "recorder.onboarding.scope.withKey",
        `Limited to ${key}`
      ),
    scopeWithoutKey: localize(
      "recorder.onboarding.scope.none",
      "Searches the full document"
    ),
    scopeNote: (key?: string) =>
      key
        ? localize(
            "recorder.onboarding.scope.note.withKey",
            `Search starts inside ${key} before falling back.`
          )
        : localize(
            "recorder.onboarding.scope.note.none",
            "Search starts at the document root."
          ),
    degradationNote: (strategyOrder: string) =>
      localize(
        "recorder.onboarding.degradation.note",
        `Falls back in order: ${strategyOrder}`
      ),
    stabilityEmpty: localize(
      "recorder.onboarding.stability.empty",
      "Not yet scored"
    )
  } satisfies TerminologyBundle;
}

function formatStability(entry: SelectorEntry | undefined, terminology: TerminologyBundle): string {
  const fallback = terminology.stabilityEmpty;

  if (!entry) {
    return fallback;
  }

  const candidateScores: number[] = [];

  if (typeof entry.stabilityScore === "number") {
    candidateScores.push(entry.stabilityScore);
  }

  entry.tries.forEach((strategy) => {
    if (typeof strategy.stabilityScore === "number") {
      candidateScores.push(strategy.stabilityScore);
    }
  });

  if (candidateScores.length === 0) {
    return fallback;
  }

  const bestScore = Math.max(...candidateScores);
  return formatHudStabilityScore(bestScore, { emptyLabel: fallback });
}

function strategyOrder(entry: SelectorEntry | undefined): string {
  const strategies: SelectorTry[] = entry?.tries ?? [];

  if (strategies.length === 0) {
    return STRATEGY_ORDER.join(" → ");
  }

  const order = strategies
    .map((strategy) => strategy.type)
    .filter((type, index, list) => list.indexOf(type) === index);

  return order.join(" → ");
}

export function buildSelectorOnboardingTooltip(
  entry: SelectorEntry | undefined,
  options?: RecorderOnboardingOptions
): RecorderOnboardingTooltip {
  const terminology = resolveTerminology(options);
  const localize = options?.localize ?? DEFAULT_LOCALIZE;

  const score = formatStability(entry, terminology);
  const scope = entry?.scopeKey
    ? terminology.scopeWithKey(entry.scopeKey)
    : terminology.scopeWithoutKey;
  const order = strategyOrder(entry);

  const headline = localize(
    "recorder.onboarding.headline",
    "Selector diagnostics"
  );
  const message = localize(
    "recorder.onboarding.message",
    "Each logical key carries stability metadata shared across the recorder, HUD, and inspector."
  );

  const degradation = terminology.degradationNote(order);
  const hudMessage = composeHudDescription("HUD notifications reuse these terms", degradation);

  return {
    headline,
    message,
    sections: [
      {
        title: `${terminology.stabilityScoreLabel}: ${score}`,
        body: terminology.stabilityNote
      },
      {
        title: `${terminology.scopeKeyLabel}: ${scope}`,
        body: terminology.scopeNote(entry?.scopeKey)
      },
      {
        title: terminology.gracefulDegradationLabel,
        body: hudMessage
      }
    ]
  } satisfies RecorderOnboardingTooltip;
}
