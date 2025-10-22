import type { ResolveResult } from "../../core/resolve";

/**
 * Workflow constants derived from requirements:
 * - Default timeout ≤ 8000ms
 * - Default polling interval ≤ 150ms
 * - Default backoff starts at 250ms with max 2000ms
 */
export const WORKFLOW_DEFAULT_TIMEOUT_MS = 8000;
export const WORKFLOW_DEFAULT_INTERVAL_MS = 150;
export const WORKFLOW_DEFAULT_BACKOFF_MS = 250;
export const WORKFLOW_DEFAULT_MAX_BACKOFF_MS = 2000;

/**
 * Logical selectors are identifiers that resolve via SelectorMap entries.
 * They must avoid raw CSS/XPath characters to stay resilient.
 */
export type LogicalKey = string & { readonly __logicalKeyBrand?: true };

export type ContextPath = string & { readonly __contextPathBrand?: true };

export type TemplateString = string;

export interface StepMetadata {
  id?: string;
  name?: string;
  description?: string;
  tags?: string[];
  scope?: string;
  timeoutMs?: number;
  intervalMs?: number;
  retries?: number;
  backoffMs?: number;
  jitterMs?: number;
  debug?: boolean;
  continueOnError?: boolean;
}

export type KeyModifierState = {
  alt?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
};

export type ClickLikeStep = StepMetadata & {
  key: LogicalKey;
  modifiers?: KeyModifierState;
};

export type ClickStep = ClickLikeStep & {
  kind: "click";
  button?: "primary" | "secondary" | "auxiliary";
  doubleClick?: boolean;
  waitForNavigationMs?: number;
};

export type HoverStep = ClickLikeStep & {
  kind: "hover";
};

export type FocusStep = ClickLikeStep & {
  kind: "focus";
};

export type BlurStep = ClickLikeStep & {
  kind: "blur";
};

export type TypeStep = StepMetadata & {
  kind: "type";
  key: LogicalKey;
  text?: TemplateString;
  fromCtx?: ContextPath;
  fromEnv?: string;
  clearFirst?: boolean;
  delayMs?: number;
  maskOutput?: boolean;
};

export type SelectStep = StepMetadata & {
  kind: "select";
  key: LogicalKey;
  value?: TemplateString;
  fromCtx?: ContextPath;
  optionBy?: "value" | "label" | "index";
  allowMultiple?: boolean;
};

export type WaitForStep = StepMetadata & {
  kind: "waitFor";
  key?: LogicalKey;
  css?: string;
  xpath?: string;
  text?: TemplateString;
  exact?: boolean;
  visible?: boolean;
  scopeKey?: LogicalKey;
};

export type WaitTextStep = StepMetadata & {
  kind: "waitText";
  text: TemplateString;
  exact?: boolean;
  withinKey?: LogicalKey;
  caseSensitive?: boolean;
};

export type DelayStep = StepMetadata & {
  kind: "delay";
  ms: number;
};

export type LogLevel = "info" | "warn" | "error" | "debug";

export type LogStep = StepMetadata & {
  kind: "log";
  level?: LogLevel;
  message: TemplateString;
  data?: Record<string, unknown>;
};

export type StepResultStatus = "success" | "skipped";

export interface StepContextUpdate {
  path: ContextPath;
  value: unknown;
  ttlMs?: number;
  mask?: boolean;
}

export interface StepLogEntry {
  level: LogLevel;
  message: string;
  data?: Record<string, unknown>;
  masked?: boolean;
}

export interface StepResult {
  status: StepResultStatus;
  notes?: string;
  contextUpdates?: StepContextUpdate[];
  logs?: StepLogEntry[];
  data?: Record<string, unknown>;
}

export interface WorkflowRuntimeLogger {
  debug?(message: string, data?: Record<string, unknown>): void;
  info?(message: string, data?: Record<string, unknown>): void;
  warn?(message: string, data?: Record<string, unknown>): void;
  error?(message: string, data?: Record<string, unknown>): void;
}

export type Assertion =
  | { kind: "exists"; key: LogicalKey }
  | { kind: "notExists"; key: LogicalKey }
  | { kind: "textContains"; key: LogicalKey; text: TemplateString; exact?: boolean; caseSensitive?: boolean }
  | { kind: "attrEquals"; key: LogicalKey; attr: string; value: TemplateString }
  | { kind: "ctxEquals"; path: ContextPath; value: unknown }
  | { kind: "ctxDefined"; path: ContextPath }
  | { kind: "urlIncludes"; value: string };

export type AssertStep = StepMetadata & {
  kind: "assert";
  check: Assertion;
  pollingMs?: number;
};

export type ContextValueSource =
  | { kind: "literal"; value: unknown }
  | { kind: "ctx"; path: ContextPath }
  | { kind: "env"; name: string }
  | { kind: "step"; stepId: string; field?: string }
  | { kind: "key"; key: LogicalKey; attr?: string; text?: boolean };

export type SetContextStep = StepMetadata & {
  kind: "setContext";
  path: ContextPath;
  value?: unknown;
  source?: ContextValueSource;
  ttlMs?: number;
  mask?: boolean;
};

export type CaptureSource =
  | { kind: "text"; key: LogicalKey; normalizeWhitespace?: boolean }
  | { kind: "attr"; key: LogicalKey; attr: string }
  | { kind: "html"; key: LogicalKey }
  | { kind: "value"; key: LogicalKey }
  | { kind: "regex"; key: LogicalKey; attr?: string; pattern: string; group?: number };

export type CaptureStep = StepMetadata & {
  kind: "capture";
  to: ContextPath;
  from: CaptureSource;
  sanitize?: boolean;
  redactKeys?: string[];
};

export interface CollectListOptions {
  parentKey: LogicalKey;
  itemKey?: LogicalKey;
  itemCss?: string;
  to?: "text" | "html" | "attrs" | "object";
  attrs?: string[];
  limit?: number;
  dedupe?: boolean | { by: "text" | "attr"; attr?: string };
  mapCtx?: ContextPath;
}

export type CollectListStep = StepMetadata & {
  kind: "collectList";
  options: CollectListOptions;
  toCtx?: ContextPath;
};

export type ScrollUntilStopCondition =
  | { kind: "end" }
  | { kind: "element"; key?: LogicalKey; css?: string; xpath?: string }
  | { kind: "listGrowth"; parentKey: LogicalKey; itemCss?: string; minDelta?: number }
  | { kind: "predicate"; expression: TemplateString };

export interface ScrollUntilOptions {
  containerKey?: LogicalKey;
  stepPx?: number;
  maxSteps?: number;
  delayMs?: number;
  timeoutMs?: number;
  until: ScrollUntilStopCondition;
}

export type ScrollUntilStep = StepMetadata & {
  kind: "scrollUntil";
  options: ScrollUntilOptions;
};

export type Condition =
  | { kind: "ctxEquals"; path: ContextPath; value: unknown }
  | { kind: "ctxNotEquals"; path: ContextPath; value: unknown }
  | { kind: "ctxDefined"; path: ContextPath }
  | { kind: "ctxMissing"; path: ContextPath }
  | { kind: "exists"; key: LogicalKey }
  | { kind: "notExists"; key: LogicalKey }
  | { kind: "textContains"; key: LogicalKey; text: TemplateString; exact?: boolean; caseSensitive?: boolean }
  | { kind: "urlIncludes"; value: string }
  | { kind: "matches"; expression: TemplateString }
  | { kind: "allOf"; conditions: Condition[] }
  | { kind: "anyOf"; conditions: Condition[] }
  | { kind: "not"; condition: Condition };

export type IfStep = StepMetadata & {
  kind: "if";
  when: Condition;
  then: WorkflowStep[];
  else?: WorkflowStep[];
};

export type ForeachStep = StepMetadata & {
  kind: "foreach";
  list: ContextPath;
  as: string;
  indexVar?: string;
  steps: WorkflowStep[];
  concurrency?: number;
};

export interface RetryPolicy {
  retries?: number;
  backoffMs?: number;
  maxBackoffMs?: number;
  jitterMs?: number;
  resetOnSuccess?: boolean;
}

export type RetryStep = StepMetadata & {
  kind: "retry";
  steps: WorkflowStep[];
  policy?: RetryPolicy;
};

export type RunStep = StepMetadata & {
  kind: "run";
  workflowId: string;
  withInput?: Record<string, unknown>;
  inheritContext?: boolean;
};

export type WorkflowStep =
  | ClickStep
  | HoverStep
  | FocusStep
  | BlurStep
  | TypeStep
  | SelectStep
  | WaitForStep
  | WaitTextStep
  | DelayStep
  | LogStep
  | AssertStep
  | SetContextStep
  | ForeachStep
  | IfStep
  | CaptureStep
  | CollectListStep
  | ScrollUntilStep
  | RunStep
  | RetryStep;

export type WorkflowStepKind = WorkflowStep["kind"];

export interface WorkflowDefaults {
  timeoutMs?: number;
  intervalMs?: number;
  retries?: number;
  backoffMs?: number;
  maxBackoffMs?: number;
  jitterMs?: number;
}

export interface WorkflowDefinition {
  id: string;
  label?: string;
  description?: string;
  tags?: string[];
  version?: string;
  defaults?: WorkflowDefaults;
  metadata?: Record<string, unknown>;
  steps: WorkflowStep[];
}

export interface StepErrorPayload {
  reason: "resolver-miss" | "timeout" | "assertion-failed" | "context-miss" | "unknown" | "cancelled";
  message: string;
  stepId?: string;
  stepKind?: WorkflowStepKind;
  logicalKey?: string;
  attempts?: number;
  elapsedMs?: number;
  data?: Record<string, unknown>;
}

export interface StepTelemetryEvent {
  runId: string;
  workflowId: string;
  stepIndex: number;
  stepId?: string;
  stepKind: WorkflowStepKind;
  logicalKey?: string;
  status: "pending" | "attempt" | "success" | "failure" | "skipped";
  attempt: number;
  timestamp: number;
  durationMs?: number;
  error?: StepErrorPayload;
  notes?: string;
}

export type WorkflowRunOutcome = {
  status: "success" | "failed" | "cancelled";
  startedAt: number;
  finishedAt: number;
  completedSteps: number;
  error?: StepErrorPayload;
  contextSnapshot: WorkflowContextSnapshot;
};

export type WorkflowContextSnapshot = Record<string, unknown>;

export interface WorkflowContext {
  readonly state: WorkflowContextSnapshot;
  get<T = unknown>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  merge(values: WorkflowContextSnapshot): void;
  snapshot(): WorkflowContextSnapshot;
}

export class InMemoryWorkflowContext implements WorkflowContext {
  #state: WorkflowContextSnapshot;

  constructor(initial?: WorkflowContextSnapshot) {
    this.#state = { ...(initial ?? {}) };
  }

  get<T = unknown>(key: string): T | undefined {
    return this.#state[key] as T | undefined;
  }

  set(key: string, value: unknown): void {
    this.#state[key] = value;
  }

  delete(key: string): void {
    delete this.#state[key];
  }

  merge(values: WorkflowContextSnapshot): void {
    Object.entries(values).forEach(([key, value]) => {
      this.#state[key] = value;
    });
  }

  snapshot(): WorkflowContextSnapshot {
    return { ...this.#state };
  }

  get state(): WorkflowContextSnapshot {
    return this.snapshot();
  }
}

export interface WorkflowStepExecutionArgs {
  step: WorkflowStep;
  attempt: number;
  retriesRemaining: number;
  context: WorkflowContext;
  resolveResult: ResolveResult | null;
  runId: string;
  workflowId: string;
  logger?: WorkflowRuntimeLogger;
  signal: AbortSignal;
  resolveLogicalKey: (key: string) => Promise<ResolveResult>;
}

export type WorkflowStepHandler = (
  args: WorkflowStepExecutionArgs
) => Promise<StepResult | void> | StepResult | void;

export type WorkflowHandlers = Record<string, WorkflowStepHandler>;

export interface WorkflowRuntimeHooks {
  beforeStep?: (args: WorkflowStepExecutionArgs) => void;
  afterStep?: (args: WorkflowStepExecutionArgs) => void;
  onError?: (error: unknown, args: WorkflowStepExecutionArgs) => void;
}

export interface ValidationIssue {
  path: string;
  message: string;
  severity: "error" | "warning";
}

export interface WorkflowValidationResult<T> {
  valid: boolean;
  issues: ValidationIssue[];
  value?: T;
}

export interface WorkflowValidatorOptions {
  allowUnknownSteps?: boolean;
}

const LOGICAL_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]*$/;

type MutableIssues = ValidationIssue[];

function pushIssue(
  issues: MutableIssues,
  path: string,
  message: string,
  severity: ValidationIssue["severity"] = "error"
): void {
  issues.push({ path, message, severity });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateLogicalKey(
  value: unknown,
  path: string,
  issues: MutableIssues,
  options: { optional?: boolean } = {}
): value is LogicalKey {
  if (!isNonEmptyString(value)) {
    if (!options.optional) {
      pushIssue(issues, path, "expected non-empty logical key");
    }
    return false;
  }

  if (!LOGICAL_KEY_PATTERN.test(value)) {
    pushIssue(issues, path, `logical key '${value}' contains disallowed characters`, "warning");
  }

  return true;
}

function validateStepMetadata(step: Record<string, unknown>, path: string, issues: MutableIssues): void {
  if ("tags" in step && step.tags !== undefined && !Array.isArray(step.tags)) {
    pushIssue(issues, `${path}.tags`, "expected tags to be an array of strings");
  }
}

function validateCondition(condition: unknown, path: string, issues: MutableIssues): condition is Condition {
  if (!isRecord(condition)) {
    pushIssue(issues, path, "expected condition to be an object");
    return false;
  }

  if (!isNonEmptyString(condition.kind)) {
    pushIssue(issues, `${path}.kind`, "condition requires kind field");
    return false;
  }

  switch (condition.kind) {
    case "ctxEquals":
    case "ctxNotEquals":
      if (!isNonEmptyString(condition.path)) {
        pushIssue(issues, `${path}.path`, "condition path must be a context string");
      }
      if (!("value" in condition)) {
        pushIssue(issues, `${path}.value`, "condition requires value field");
      }
      break;
    case "ctxDefined":
    case "ctxMissing":
      if (!isNonEmptyString(condition.path)) {
        pushIssue(issues, `${path}.path`, "condition path must be a context string");
      }
      break;
    case "exists":
    case "notExists":
      validateLogicalKey(condition.key, `${path}.key`, issues);
      break;
    case "textContains":
      validateLogicalKey(condition.key, `${path}.key`, issues);
      if (!isNonEmptyString(condition.text)) {
        pushIssue(issues, `${path}.text`, "text condition requires text");
      }
      break;
    case "urlIncludes":
      if (!isNonEmptyString(condition.value)) {
        pushIssue(issues, `${path}.value`, "urlIncludes condition requires value");
      }
      break;
    case "matches":
      if (!isNonEmptyString(condition.expression)) {
        pushIssue(issues, `${path}.expression`, "matches condition requires expression");
      }
      break;
    case "allOf":
    case "anyOf":
      if (!Array.isArray(condition.conditions) || condition.conditions.length === 0) {
        pushIssue(issues, `${path}.conditions`, "logical condition requires at least one nested condition");
      } else {
        condition.conditions.forEach((child, index) => {
          validateCondition(child, `${path}.conditions[${index}]`, issues);
        });
      }
      break;
    case "not":
      if (!("condition" in condition)) {
        pushIssue(issues, `${path}.condition`, "not condition requires nested condition");
      } else {
        validateCondition(condition.condition, `${path}.condition`, issues);
      }
      break;
    default:
      pushIssue(issues, path, `unknown condition kind '${condition.kind}'`, "warning");
  }

  return true;
}

function validateAssertion(assertion: unknown, path: string, issues: MutableIssues): assertion is Assertion {
  if (!isRecord(assertion)) {
    pushIssue(issues, path, "expected assertion to be an object");
    return false;
  }

  if (!isNonEmptyString(assertion.kind)) {
    pushIssue(issues, `${path}.kind`, "assertion requires kind field");
    return false;
  }

  switch (assertion.kind) {
    case "exists":
    case "notExists":
      validateLogicalKey(assertion.key, `${path}.key`, issues);
      break;
    case "textContains":
      validateLogicalKey(assertion.key, `${path}.key`, issues);
      if (!isNonEmptyString(assertion.text)) {
        pushIssue(issues, `${path}.text`, "textContains assertion requires text");
      }
      break;
    case "attrEquals":
      validateLogicalKey(assertion.key, `${path}.key`, issues);
      if (!isNonEmptyString(assertion.attr)) {
        pushIssue(issues, `${path}.attr`, "attrEquals assertion requires attr name");
      }
      if (!isNonEmptyString(assertion.value)) {
        pushIssue(issues, `${path}.value`, "attrEquals assertion requires value");
      }
      break;
    case "ctxEquals":
      if (!isNonEmptyString(assertion.path)) {
        pushIssue(issues, `${path}.path`, "ctxEquals assertion requires context path");
      }
      if (!("value" in assertion)) {
        pushIssue(issues, `${path}.value`, "ctxEquals assertion requires value");
      }
      break;
    case "ctxDefined":
      if (!isNonEmptyString(assertion.path)) {
        pushIssue(issues, `${path}.path`, "ctxDefined assertion requires context path");
      }
      break;
    case "urlIncludes":
      if (!isNonEmptyString(assertion.value)) {
        pushIssue(issues, `${path}.value`, "urlIncludes assertion requires value");
      }
      break;
    default:
      pushIssue(issues, path, `unknown assertion kind '${assertion.kind}'`, "warning");
  }

  return true;
}

type StepValidator = (step: Record<string, unknown>, path: string, issues: MutableIssues) => void;

const STEP_VALIDATORS: Record<string, StepValidator> = {
  click(step, path, issues) {
    validateLogicalKey(step.key, `${path}.key`, issues);
  },
  hover(step, path, issues) {
    validateLogicalKey(step.key, `${path}.key`, issues);
  },
  focus(step, path, issues) {
    validateLogicalKey(step.key, `${path}.key`, issues);
  },
  blur(step, path, issues) {
    validateLogicalKey(step.key, `${path}.key`, issues);
  },
  type(step, path, issues) {
    validateLogicalKey(step.key, `${path}.key`, issues);
    if (step.fromCtx !== undefined && !isNonEmptyString(step.fromCtx)) {
      pushIssue(issues, `${path}.fromCtx`, "fromCtx must be a non-empty string if provided");
    }
    if (step.fromEnv !== undefined && !isNonEmptyString(step.fromEnv)) {
      pushIssue(issues, `${path}.fromEnv`, "fromEnv must be a non-empty string if provided");
    }
  },
  select(step, path, issues) {
    validateLogicalKey(step.key, `${path}.key`, issues);
    if (step.fromCtx !== undefined && !isNonEmptyString(step.fromCtx)) {
      pushIssue(issues, `${path}.fromCtx`, "fromCtx must be a string");
    }
  },
  waitFor(step, path, issues) {
    const hasKey = step.key !== undefined ? validateLogicalKey(step.key, `${path}.key`, issues) : false;
    const hasCss = isNonEmptyString(step.css ?? undefined);
    const hasXpath = isNonEmptyString(step.xpath ?? undefined);
    const hasText = isNonEmptyString(step.text ?? undefined);

    if (!hasKey && !hasCss && !hasXpath && !hasText) {
      pushIssue(issues, path, "waitFor step requires at least one of key, css, xpath, or text");
    }
  },
  waitText(step, path, issues) {
    if (!isNonEmptyString(step.text)) {
      pushIssue(issues, `${path}.text`, "waitText step requires text value");
    }
    if (step.withinKey !== undefined) {
      validateLogicalKey(step.withinKey, `${path}.withinKey`, issues, { optional: true });
    }
  },
  delay(step, path, issues) {
    if (typeof step.ms !== "number" || !Number.isFinite(step.ms) || step.ms < 0) {
      pushIssue(issues, `${path}.ms`, "delay requires non-negative duration in milliseconds");
    }
  },
  log(step, path, issues) {
    if (!isNonEmptyString(step.message)) {
      pushIssue(issues, `${path}.message`, "log step requires message");
    }
  },
  assert(step, path, issues) {
    validateAssertion(step.check, `${path}.check`, issues);
  },
  setContext(step, path, issues) {
    if (!isNonEmptyString(step.path)) {
      pushIssue(issues, `${path}.path`, "setContext requires path");
    }
    if (step.source !== undefined && !isRecord(step.source)) {
      pushIssue(issues, `${path}.source`, "source must be an object if provided");
    }
  },
  foreach(step, path, issues) {
    if (!isNonEmptyString(step.list)) {
      pushIssue(issues, `${path}.list`, "foreach requires list context path");
    }
    if (!isNonEmptyString(step.as)) {
      pushIssue(issues, `${path}.as`, "foreach requires alias 'as'");
    }
    if (!Array.isArray(step.steps) || step.steps.length === 0) {
      pushIssue(issues, `${path}.steps`, "foreach requires nested steps array");
    } else {
      step.steps.forEach((nested, index) => {
        validateStep(nested, `${path}.steps[${index}]`, issues);
      });
    }
  },
  if(step, path, issues) {
    if (!validateCondition(step.when, `${path}.when`, issues)) {
      return;
    }

    if (!Array.isArray(step.then) || step.then.length === 0) {
      pushIssue(issues, `${path}.then`, "if step requires then steps");
    } else {
      step.then.forEach((nested, index) => {
        validateStep(nested, `${path}.then[${index}]`, issues);
      });
    }

    if (Array.isArray(step.else)) {
      step.else.forEach((nested, index) => {
        validateStep(nested, `${path}.else[${index}]`, issues);
      });
    } else if (step.else !== undefined) {
      pushIssue(issues, `${path}.else`, "else must be an array of steps");
    }
  },
  capture(step, path, issues) {
    if (!isNonEmptyString(step.to)) {
      pushIssue(issues, `${path}.to`, "capture requires context destination");
    }
    if (!isRecord(step.from)) {
      pushIssue(issues, `${path}.from`, "capture requires from specification");
      return;
    }
    if (!isNonEmptyString(step.from.kind)) {
      pushIssue(issues, `${path}.from.kind`, "capture source requires kind");
      return;
    }
    if (step.from.kind !== "regex") {
      validateLogicalKey(step.from.key, `${path}.from.key`, issues);
    } else if (step.from.kind === "regex") {
      validateLogicalKey(step.from.key, `${path}.from.key`, issues);
      if (!isNonEmptyString(step.from.pattern)) {
        pushIssue(issues, `${path}.from.pattern`, "regex capture requires pattern");
      }
    }
  },
  collectList(step, path, issues) {
    if (!isRecord(step.options)) {
      pushIssue(issues, `${path}.options`, "collectList requires options object");
      return;
    }
    validateLogicalKey(step.options.parentKey, `${path}.options.parentKey`, issues);
    if (step.options.itemKey !== undefined) {
      validateLogicalKey(step.options.itemKey, `${path}.options.itemKey`, issues, { optional: true });
    }
  },
  scrollUntil(step, path, issues) {
    if (!isRecord(step.options)) {
      pushIssue(issues, `${path}.options`, "scrollUntil requires options object");
      return;
    }
    if (step.options.containerKey !== undefined) {
      validateLogicalKey(step.options.containerKey, `${path}.options.containerKey`, issues, { optional: true });
    }
    if (!isRecord(step.options.until)) {
      pushIssue(issues, `${path}.options.until`, "scrollUntil requires until condition");
    }
  },
  run(step, path, issues) {
    if (!isNonEmptyString(step.workflowId)) {
      pushIssue(issues, `${path}.workflowId`, "run step requires workflowId");
    }
  },
  retry(step, path, issues) {
    if (!Array.isArray(step.steps) || step.steps.length === 0) {
      pushIssue(issues, `${path}.steps`, "retry step requires nested steps");
    } else {
      step.steps.forEach((nested, index) => {
        validateStep(nested, `${path}.steps[${index}]`, issues);
      });
    }
    if (step.policy !== undefined && !isRecord(step.policy)) {
      pushIssue(issues, `${path}.policy`, "retry policy must be object");
    }
  }
};

function validateStep(step: unknown, path: string, issues: MutableIssues): step is WorkflowStep {
  if (!isRecord(step)) {
    pushIssue(issues, path, "step must be an object");
    return false;
  }

  if (!isNonEmptyString(step.kind)) {
    pushIssue(issues, `${path}.kind`, "step requires kind field");
    return false;
  }

  validateStepMetadata(step, path, issues);

  const validator = STEP_VALIDATORS[step.kind];

  if (!validator) {
    pushIssue(issues, path, `unknown step kind '${step.kind}'`, "error");
    return false;
  }

  validator(step, path, issues);
  return true;
}

export function validateWorkflowDefinition(
  value: unknown,
  options: WorkflowValidatorOptions = {}
): WorkflowValidationResult<WorkflowDefinition> {
  const issues: MutableIssues = [];

  if (!isRecord(value)) {
    pushIssue(issues, "root", "workflow definition must be an object");
    return { valid: false, issues };
  }

  if (!isNonEmptyString(value.id)) {
    pushIssue(issues, "root.id", "workflow id must be a non-empty string");
  }

  if (!Array.isArray(value.steps) || value.steps.length === 0) {
    pushIssue(issues, "root.steps", "workflow requires at least one step");
  } else {
    value.steps.forEach((step, index) => {
      const valid = validateStep(step, `root.steps[${index}]`, issues);
      if (!valid && options.allowUnknownSteps) {
        issues.pop();
      }
    });
  }

  if (value.defaults !== undefined) {
    if (!isRecord(value.defaults)) {
      pushIssue(issues, "root.defaults", "defaults must be an object");
    }
  }

  const fatal = issues.some((issue) => issue.severity === "error");

  return {
    valid: !fatal,
    issues,
    value: !fatal ? (value as unknown as WorkflowDefinition) : undefined
  };
}

export function isWorkflowDefinition(value: unknown): value is WorkflowDefinition {
  return validateWorkflowDefinition(value).valid;
}

export function assertWorkflowDefinition(value: unknown, message?: string): asserts value is WorkflowDefinition {
  const result = validateWorkflowDefinition(value);

  if (!result.valid) {
    const errors = result.issues
      .filter((issue) => issue.severity === "error")
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join("; ");

    throw new Error(message ?? `Invalid workflow definition: ${errors}`);
  }
}

export function validateWorkflowStep(value: unknown): WorkflowValidationResult<WorkflowStep> {
  const issues: MutableIssues = [];
  const valid = validateStep(value, "step", issues);
  return {
    valid,
    issues,
    value: valid ? (value as WorkflowStep) : undefined
  };
}
