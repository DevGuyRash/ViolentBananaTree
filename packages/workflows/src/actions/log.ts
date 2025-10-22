import {
  buildHandler,
  buildResult,
  renderTemplate,
  sanitizeEntry,
  withEnvironment,
  type ActionExecutionArgs,
  type ActionRuntimeOptions
} from "./shared";
import type { LogLevel, LogStep, WorkflowStepHandler } from "../types";

function sanitizeData(data: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!data) {
    return undefined;
  }

  const result: Record<string, unknown> = {};

  Object.entries(data).forEach(([key, value]) => {
    result[key] = sanitizeEntry(key, value);
  });

  return result;
}

async function executeLog(args: ActionExecutionArgs<LogStep>, runtime: ActionRuntimeOptions) {
  const { step } = args;
  const templateOptions = withEnvironment(args, runtime.environment);
  const level: LogLevel = step.level ?? "info";
  const message = renderTemplate(step.message, templateOptions);
  const sanitizedData = sanitizeData(step.data);

  return buildResult("success", {
    notes: message,
    logs: [
      {
        level,
        message,
        data: sanitizedData
      }
    ],
    data: sanitizedData
  });
}

export function createLogHandler(options: ActionRuntimeOptions = {}): WorkflowStepHandler {
  return buildHandler(executeLog, options);
}
