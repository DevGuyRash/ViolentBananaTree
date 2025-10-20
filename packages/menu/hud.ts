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
