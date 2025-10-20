import type { ResolverAttemptSummary } from "../core/resolve-telemetry";

export type OverlayDiagnostics = {
  stabilityScore?: number;
  tags?: string[];
  degradation?: string;
  attempts: ResolverAttemptSummary[];
};

export type OverlayTooltip = {
  title: string;
  description?: string;
  diagnostics?: OverlayDiagnostics;
};

export type OverlayTarget = {
  element: Element;
  logicalKey: string;
};

export type OverlayRenderer = {
  attach(target: OverlayTarget, tooltip: OverlayTooltip): void;
  detach(key: string): void;
};

let renderer: OverlayRenderer | null = null;

export function registerOverlayRenderer(next: OverlayRenderer): void {
  renderer = next;
}

export function unregisterOverlayRenderer(): void {
  renderer = null;
}

export function showOverlay(target: OverlayTarget, tooltip: OverlayTooltip): void {
  renderer?.attach(target, sanitizeTooltip(tooltip));
}

export function hideOverlay(logicalKey: string): void {
  renderer?.detach(logicalKey);
}

function sanitizeTooltip(tooltip: OverlayTooltip): OverlayTooltip {
  if (!tooltip.diagnostics) {
    return tooltip;
  }

  return {
    ...tooltip,
    diagnostics: sanitizeDiagnostics(tooltip.diagnostics)
  };
}

function sanitizeDiagnostics(diagnostics: OverlayDiagnostics): OverlayDiagnostics {
  const trimmedNotes = diagnostics.degradation?.trim();
  return {
    stabilityScore: numberOrUndefined(diagnostics.stabilityScore),
    tags: sanitizeTags(diagnostics.tags),
    degradation: trimmedNotes && trimmedNotes.length > 0 ? trimmedNotes : undefined,
    attempts: diagnostics.attempts.map(sanitizeAttempt)
  };
}

function sanitizeAttempt(attempt: ResolverAttemptSummary): ResolverAttemptSummary {
  const { tags, ...rest } = attempt;
  return {
    ...rest,
    tags: sanitizeTags(tags)
  };
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function sanitizeTags(tags?: string[] | null): string[] | undefined {
  if (!tags) {
    return undefined;
  }

  const sanitized = tags
    .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
    .filter((tag) => tag.length > 0)
    .slice(0, 10);

  return sanitized.length > 0 ? sanitized : undefined;
}
