import { wait } from "../../../core/utils/wait";
import type { ResolveResult } from "../../../core/resolve";
import {
  WORKFLOW_DEFAULT_INTERVAL_MS,
  WORKFLOW_DEFAULT_TIMEOUT_MS,
  type ContextPath,
  type StepContextUpdate,
  type StepLogEntry,
  type StepResult,
  type StepResultStatus,
  type TemplateString,
  type WorkflowContext,
  type WorkflowStep,
  type WorkflowStepExecutionArgs,
  type WorkflowStepHandler
} from "../types";

export const SENSITIVE_KEY_PATTERN = /(password|secret|token|auth|cookie|session|key)/i;

export type EnvironmentLookup = Record<string, string | undefined>;

export interface ActionRuntimeOptions {
  environment?: EnvironmentLookup;
}

export type ActionExecutionArgs<TStep extends WorkflowStep> = WorkflowStepExecutionArgs & {
  step: TStep;
};

export type ActionExecutor<TStep extends WorkflowStep> = (
  args: ActionExecutionArgs<TStep>,
  options: ActionRuntimeOptions
) => Promise<StepResult> | StepResult;

export interface TemplateRenderOptions {
  context: WorkflowContext;
  environment?: EnvironmentLookup;
}

export interface PollOptions {
  timeoutMs?: number;
  intervalMs?: number;
  signal?: AbortSignal;
}

export function maskValue(value: unknown): string {
  if (typeof value === "string" && value.length <= 4) {
    return "****";
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return "****";
  }

  if (value === null || typeof value === "undefined") {
    return "****";
  }

  return "********";
}

export function sanitizeEntry(key: string | undefined, value: unknown, mask?: boolean): unknown {
  if (!key) {
    return mask ? maskValue(value) : value;
  }

  if (mask || SENSITIVE_KEY_PATTERN.test(key)) {
    return maskValue(value);
  }

  return value;
}

export function renderTemplate(template: TemplateString | undefined, options: TemplateRenderOptions): string {
  if (!template) {
    return "";
  }

  return template.replace(/\$\{(ctx|env):([^}]+)\}/g, (_match, kind: string, identifier: string) => {
    if (kind === "ctx") {
      const ctxValue = options.context.get(identifier.trim());
      return typeof ctxValue === "undefined" || ctxValue === null ? "" : String(ctxValue);
    }

    if (kind === "env") {
      const envValue = resolveEnvValue(identifier.trim(), options.environment);
      return typeof envValue === "undefined" ? "" : envValue;
    }

    return "";
  });
}

export function resolveEnvValue(name: string, environment?: EnvironmentLookup): string | undefined {
  if (environment && Object.prototype.hasOwnProperty.call(environment, name)) {
    const value = environment[name];
    return typeof value === "undefined" ? undefined : String(value);
  }

  if (typeof process !== "undefined" && process.env && Object.prototype.hasOwnProperty.call(process.env, name)) {
    const value = process.env[name];
    return typeof value === "undefined" ? undefined : String(value);
  }

  const globalAny = globalThis as Record<string, unknown>;
  const container = globalAny?.DGX_ENV;

  if (container && typeof container === "object" && name in (container as Record<string, unknown>)) {
    const value = (container as Record<string, unknown>)[name];
    return typeof value === "undefined" || value === null ? undefined : String(value);
  }

  return undefined;
}

export function resolveContextValue(context: WorkflowContext, path?: ContextPath | null): unknown {
  if (!path) {
    return undefined;
  }

  return context.get(path);
}

export function resolveTemplateOrContext(
  template: TemplateString | undefined,
  path: ContextPath | undefined,
  options: TemplateRenderOptions
): string {
  if (typeof path === "string" && path.length > 0) {
    const value = resolveContextValue(options.context, path);
    return typeof value === "undefined" || value === null ? "" : String(value);
  }

  return renderTemplate(template, options);
}

export async function pollUntil(predicate: () => boolean | Promise<boolean>, options: PollOptions = {}): Promise<boolean> {
  const timeoutMs = typeof options.timeoutMs === "number" ? Math.max(0, options.timeoutMs) : WORKFLOW_DEFAULT_TIMEOUT_MS;
  const intervalMs = typeof options.intervalMs === "number" ? Math.max(10, options.intervalMs) : WORKFLOW_DEFAULT_INTERVAL_MS;
  const startedAt = Date.now();

  while (true) {
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new DOMException("Operation aborted", "AbortError");
    }

    const result = await Promise.resolve(predicate());

    if (result) {
      return true;
    }

    const elapsed = Date.now() - startedAt;

    if (elapsed >= timeoutMs) {
      return false;
    }

    await wait(intervalMs, { signal: options.signal });
  }
}

export function requireElement(result: ResolveResult | null, message: string): Element {
  const element = result?.element ?? null;

  if (!element) {
    throw new Error(message);
  }

  return element;
}

export function buildResult(
  status: StepResultStatus,
  options: {
    notes?: string;
    contextUpdates?: StepContextUpdate[];
    logs?: StepLogEntry[];
    data?: Record<string, unknown>;
  } = {}
): StepResult {
  return {
    status,
    notes: options.notes,
    contextUpdates: options.contextUpdates?.filter(Boolean),
    logs: options.logs?.filter(Boolean),
    data: options.data
  } satisfies StepResult;
}

export function toContextUpdate(path: ContextPath, value: unknown, ttlMs?: number, mask?: boolean): StepContextUpdate {
  return {
    path,
    value,
    ttlMs,
    mask
  } satisfies StepContextUpdate;
}

export function isHTMLElement(node: unknown): node is HTMLElement {
  return node instanceof HTMLElement;
}

export function coerceToArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === null || typeof value === "undefined") {
    return [];
  }

  return [value];
}

export function safeTextContent(element: Element | null | undefined): string {
  return element?.textContent?.trim() ?? "";
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function matchesText(
  actual: string,
  expected: string,
  options: { exact?: boolean; caseSensitive?: boolean }
): boolean {
  const normalizedActual = options.caseSensitive ? actual : actual.toLowerCase();
  const normalizedExpected = options.caseSensitive ? expected : expected.toLowerCase();

  if (options.exact) {
    return normalizedActual === normalizedExpected;
  }

  return normalizedActual.includes(normalizedExpected);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function isVisible(element: Element | null | undefined): boolean {
  if (!element || !(element instanceof HTMLElement)) {
    return false;
  }

  const style = globalThis.getComputedStyle?.(element);

  if (!style) {
    return true;
  }

  return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
}

export function withEnvironment(
  args: WorkflowStepExecutionArgs,
  environment?: EnvironmentLookup
): TemplateRenderOptions {
  return {
    context: args.context,
    environment
  } satisfies TemplateRenderOptions;
}

export function buildHandler<TStep extends WorkflowStep>(
  executor: ActionExecutor<TStep>,
  options: ActionRuntimeOptions
): WorkflowStepHandler {
  return (args) => {
    return Promise.resolve(executor(args as ActionExecutionArgs<TStep>, options));
  };
}
