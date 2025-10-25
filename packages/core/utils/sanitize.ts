const MASK_PLACEHOLDER = "[***masked***]";

function normalizeString(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function shouldMask(value: string | null | undefined): boolean {
  if (value === null || typeof value === "undefined") {
    return false;
  }

  if (value.length === 0) {
    return false;
  }

  return true;
}

export function maskText(value: string | null | undefined): string | null {
  if (!shouldMask(value) || value === null) {
    return value ?? null;
  }

  if (typeof value === "undefined") {
    return null;
  }

  const normalized = normalizeString(value);
  if (normalized.length === 0) {
    return "";
  }

  return MASK_PLACEHOLDER;
}

export function sanitizeText(value: string | null | undefined, sanitize?: boolean): string | null {
  if (!sanitize) {
    return value ?? null;
  }

  return maskText(value);
}

export function sanitizePattern(pattern: RegExp | undefined, sanitize?: boolean): RegExp | undefined {
  if (!sanitize) {
    return pattern;
  }

  return undefined;
}

export { MASK_PLACEHOLDER };
