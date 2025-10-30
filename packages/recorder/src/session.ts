import {
  hydrateReplayContext,
  registerCaptureHooks,
  type RecorderScrollCaptureHooks,
  type RecorderScrollContext
} from "../../core/utils/scroll/recording";
import type { ScrollUntilOptions } from "../../workflows/src/types";

export interface RecorderScrollCaptureExtras {
  id?: string;
  name?: string;
  description?: string;
  tags?: string[];
  debug?: boolean;
  options?: Partial<ScrollUntilOptions>;
  metadata?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  notes?: string[];
}

export interface RecorderScrollCaptureResult extends RecorderScrollCaptureExtras {
  context: RecorderScrollContext;
}

export interface RecorderScrollCapture {
  hooks: RecorderScrollCaptureHooks;
  finalize(extras?: RecorderScrollCaptureExtras): RecorderScrollCaptureResult;
  snapshot(): RecorderScrollContext;
}

export function createRecorderScrollCapture(initial?: Partial<RecorderScrollContext>): RecorderScrollCapture {
  const hooks = registerCaptureHooks(initial);
  let cached: RecorderScrollContext | undefined;

  const snapshot = (): RecorderScrollContext => {
    const context = hydrateReplayContext(cached ?? hooks.finalize()) ?? hooks.finalize();
    cached = context;
    return context;
  };

  return {
    hooks,
    finalize(extras) {
      const baseContext = snapshot();
      const mergedNotes = mergeNotes(baseContext.notes, extras?.notes);
      const context = mergedNotes ? { ...baseContext, notes: mergedNotes } : baseContext;
      cached = context;

      const normalizedExtras = normalizeExtras(extras);

      return {
        ...(normalizedExtras ?? {}),
        context
      } satisfies RecorderScrollCaptureResult;
    },
    snapshot
  } satisfies RecorderScrollCapture;
}

function normalizeExtras(extras?: RecorderScrollCaptureExtras): RecorderScrollCaptureExtras | undefined {
  if (!extras) {
    return undefined;
  }

  const output: RecorderScrollCaptureExtras = {};

  if (extras.id) {
    output.id = extras.id;
  }

  if (extras.name) {
    output.name = extras.name;
  }

  if (extras.description) {
    output.description = extras.description;
  }

  if (Array.isArray(extras.tags) && extras.tags.length > 0) {
    output.tags = dedupeStrings(extras.tags);
  }

  if (typeof extras.debug === "boolean") {
    output.debug = extras.debug;
  }

  if (extras.options) {
    output.options = { ...extras.options } satisfies Partial<ScrollUntilOptions>;
  }

  if (extras.metadata) {
    output.metadata = cloneValue(extras.metadata) as Record<string, unknown>;
  }

  if (extras.annotations) {
    output.annotations = cloneValue(extras.annotations) as Record<string, unknown>;
  }

  if (Array.isArray(extras.notes) && extras.notes.length > 0) {
    output.notes = dedupeStrings(extras.notes);
  }

  return Object.keys(output).length > 0 ? output : undefined;
}

function mergeNotes(existing?: string[], extras?: string[]): string[] | undefined {
  if ((!existing || existing.length === 0) && (!extras || extras.length === 0)) {
    return existing;
  }

  const combined = dedupeStrings([...(existing ?? []), ...(extras ?? [])]);
  return combined.length > 0 ? combined : undefined;
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    output.push(trimmed);
  }

  return output;
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneValue(entry)) as unknown as T;
  }

  if (isPlainRecord(value)) {
    const output: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
      if (typeof entry === "undefined") {
        return;
      }
      output[key] = cloneValue(entry);
    });
    return output as unknown as T;
  }

  if (typeof value === "function") {
    return "[function]" as unknown as T;
  }

  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
