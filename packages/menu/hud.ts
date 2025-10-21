export type HudLevel = "info" | "warn" | "error";

export type HudSeverity = "stable" | "warning" | "critical" | "unknown";

export type HudDiagnosticAttempt = {
  index: number;
  type: string;
  elementCount: number;
  stabilityScore?: number;
  uniqueInScope?: boolean;
};

export type HudDiagnostics = {
  stabilityScore?: number;
  severity: HudSeverity;
  tags?: string[];
  degradation?: string;
  attempts?: HudDiagnosticAttempt[];
  source?: string;
};

export type HudNotification = {
  id: string;
  title: string;
  description?: string;
  level: HudLevel;
  diagnostics?: HudDiagnostics;
  metadata?: Record<string, unknown>;
};

export type HudTerminologyKey =
  | "hud.stabilityScoreLabel"
  | "hud.scopeKeyLabel"
  | "hud.gracefulDegradationLabel";

export type HudTerminology = {
  stabilityScoreLabel: string;
  scopeKeyLabel: string;
  gracefulDegradationLabel: string;
};

export type HudLocalize = (key: HudTerminologyKey, fallback: string) => string;

const DEFAULT_TERMINOLOGY: Record<HudTerminologyKey, string> = {
  "hud.stabilityScoreLabel": "Stability score",
  "hud.scopeKeyLabel": "Scope key",
  "hud.gracefulDegradationLabel": "Graceful degradation"
};

const DEFAULT_LOCALIZE: HudLocalize = (_key, fallback) => fallback;

type HudEmitter = {
  notify: (notification: HudNotification) => void;
};

let emitter: HudEmitter | null = null;

export function registerHudEmitter(next: HudEmitter): void {
  emitter = next;
}

export function clearHudEmitter(): void {
  emitter = null;
}

export function pushHudNotification(notification: HudNotification): void {
  emitter?.notify(notification);
}

export function composeHudDescription(primary: string, degradation?: string): string {
  const primaryTrimmed = primary.trim();
  const degradationTrimmed = degradation?.trim() ?? "";

  if (!degradationTrimmed) {
    return primaryTrimmed;
  }

  if (!primaryTrimmed) {
    return degradationTrimmed;
  }

  return `${degradationTrimmed}\n${primaryTrimmed}`;
}

export function resolveHudTerminology(localize: HudLocalize = DEFAULT_LOCALIZE): HudTerminology {
  return {
    stabilityScoreLabel: localize(
      "hud.stabilityScoreLabel",
      DEFAULT_TERMINOLOGY["hud.stabilityScoreLabel"]
    ),
    scopeKeyLabel: localize("hud.scopeKeyLabel", DEFAULT_TERMINOLOGY["hud.scopeKeyLabel"]),
    gracefulDegradationLabel: localize(
      "hud.gracefulDegradationLabel",
      DEFAULT_TERMINOLOGY["hud.gracefulDegradationLabel"]
    )
  };
}

export function formatHudStabilityScore(
  score: number | undefined,
  options: { emptyLabel?: string } = {}
): string {
  if (typeof score !== "number" || Number.isNaN(score)) {
    return options.emptyLabel ?? "N/A";
  }

  const normalized = Math.max(0, Math.min(1, score));
  const percent = Math.round(normalized * 100);
  return `${percent}%`;
}
