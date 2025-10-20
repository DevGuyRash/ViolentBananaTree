type LogLevel = "debug" | "info" | "warn" | "error";

type LogContext = {
  prefix?: string;
  sanitize?: (value: unknown) => unknown;
};

const DEFAULT_PREFIX = "[DGX]";

function formatMessage(prefix: string, message: string): string {
  return `${prefix} ${message}`;
}

function sanitizePayload(value: unknown, context?: LogContext): unknown {
  if (!context?.sanitize) {
    return value;
  }

  try {
    return context.sanitize(value);
  } catch {
    return value;
  }
}

function log(level: LogLevel, message: string, data?: unknown, context?: LogContext): void {
  const prefix = context?.prefix ?? DEFAULT_PREFIX;
  const payload = sanitizePayload(data, context);

  if (typeof console === "undefined") {
    return;
  }

  const method = console[level] ?? console.log;

  if (typeof payload === "undefined") {
    method(formatMessage(prefix, message));
  } else {
    method(formatMessage(prefix, message), payload);
  }
}

export function debug(message: string, data?: unknown, context?: LogContext): void {
  log("debug", message, data, context);
}

export function info(message: string, data?: unknown, context?: LogContext): void {
  log("info", message, data, context);
}

export function warn(message: string, data?: unknown, context?: LogContext): void {
  log("warn", message, data, context);
}

export function error(message: string, data?: unknown, context?: LogContext): void {
  log("error", message, data, context);
}

export type { LogContext, LogLevel };

