import type { WorkflowHandlers } from "../types";
import { createClickHandler } from "./click";
import { createHoverHandler } from "./hover";
import { createFocusHandler } from "./focus";
import { createBlurHandler } from "./blur";
import { createTypeHandler } from "./type";
import { createSelectHandler } from "./select";
import { createWaitForHandler } from "./waitFor";
import { createWaitTextHandler } from "./waitText";
import { createWaitVisibleHandler } from "./waitVisible";
import { createWaitHiddenHandler } from "./waitHidden";
import { createWaitForIdleHandler } from "./waitForIdle";
import { createDelayHandler } from "./delay";
import { createLogHandler } from "./log";
import { createSetContextHandler } from "./setContext";
import { createCaptureHandler } from "./capture";
import { createAssertHandler } from "./assert";
import { createCollectListHandler } from "./collectList";
import { createScrollHandlers } from "./scroll";
import { createRunHandler } from "./run";
import type { ActionRuntimeOptions } from "./shared";

export interface CreateActionHandlersOptions extends ActionRuntimeOptions {}

export function createActionHandlers(options: CreateActionHandlersOptions = {}): WorkflowHandlers {
  const scroll = createScrollHandlers(options);

  return {
    click: createClickHandler(options),
    hover: createHoverHandler(options),
    focus: createFocusHandler(options),
    blur: createBlurHandler(options),
    type: createTypeHandler(options),
    select: createSelectHandler(options),
    waitFor: createWaitForHandler(options),
    waitText: createWaitTextHandler(options),
    waitVisible: createWaitVisibleHandler(options),
    waitHidden: createWaitHiddenHandler(options),
    waitForIdle: createWaitForIdleHandler(options),
    delay: createDelayHandler(options),
    log: createLogHandler(options),
    setContext: createSetContextHandler(options),
    capture: createCaptureHandler(options),
    assert: createAssertHandler(options),
    collectList: createCollectListHandler(options),
    scrollIntoView: scroll.scrollIntoView,
    scrollUntil: scroll.scrollUntil,
    run: createRunHandler(options)
  } as WorkflowHandlers;
}
