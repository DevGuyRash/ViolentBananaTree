import type { WorkflowHandlers } from "../types";
import { createClickHandler } from "./click";
import { createHoverHandler } from "./hover";
import { createFocusHandler } from "./focus";
import { createBlurHandler } from "./blur";
import { createTypeHandler } from "./type";
import { createSelectHandler } from "./select";
import { createWaitForHandler } from "./waitFor";
import { createWaitTextHandler } from "./waitText";
import { createDelayHandler } from "./delay";
import { createLogHandler } from "./log";
import { createSetContextHandler } from "./setContext";
import { createCaptureHandler } from "./capture";
import { createAssertHandler } from "./assert";
import { createCollectListHandler } from "./collectList";
import { createScrollUntilHandler } from "./scrollUntil";
import { createRunHandler } from "./run";
import type { ActionRuntimeOptions } from "./shared";

export interface CreateActionHandlersOptions extends ActionRuntimeOptions {}

export function createActionHandlers(options: CreateActionHandlersOptions = {}): WorkflowHandlers {
  return {
    click: createClickHandler(options),
    hover: createHoverHandler(options),
    focus: createFocusHandler(options),
    blur: createBlurHandler(options),
    type: createTypeHandler(options),
    select: createSelectHandler(options),
    waitFor: createWaitForHandler(options),
    waitText: createWaitTextHandler(options),
    delay: createDelayHandler(options),
    log: createLogHandler(options),
    setContext: createSetContextHandler(options),
    capture: createCaptureHandler(options),
    assert: createAssertHandler(options),
    collectList: createCollectListHandler(options),
    scrollUntil: createScrollUntilHandler(options),
    run: createRunHandler(options)
  } as WorkflowHandlers;
}
