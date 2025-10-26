import { sanitizeText } from "../sanitize";
import {
  createMutationIdleGate,
  type MutationIdleGateDependencies,
  type MutationIdleGateResult,
  type MutationIdleGateTelemetry,
  type MutationIdleGateWaitOptions
} from "./idle-gate";
import { createTextPredicate, type TextPredicateConfig } from "./predicates/text";
import { createVisibilityPredicate } from "./predicates/visibility";
import {
  createWaitScheduler,
  type WaitLogger,
  type WaitPredicate,
  type WaitScheduleOptions,
  type WaitScheduler,
  type WaitSchedulerDependencies
} from "./scheduler";
import { createWaitScrollIntegration } from "./integration-scroll";
import type {
  IdleWindowOptions,
  VisibilityOptions,
  WaitOptions,
  WaitPredicateSnapshot,
  WaitResult
} from "./types";

type MutationIdleGateInstance = ReturnType<typeof createMutationIdleGate>;

export interface WaitHelpersDependencies extends WaitSchedulerDependencies {
  scheduler?: WaitScheduler;
  createScheduler?: (dependencies: WaitSchedulerDependencies) => WaitScheduler;
  idleGate?: MutationIdleGateInstance;
  createIdleGate?: (dependencies?: MutationIdleGateDependencies) => MutationIdleGateInstance;
  idleGateDependencies?: MutationIdleGateDependencies;
  idleGateTelemetry?: MutationIdleGateTelemetry | null;
  createScrollIntegration?: typeof createWaitScrollIntegration;
}

export type WaitForOptions = WaitOptions;

export interface WaitTextOptions extends WaitOptions {
  text?: string;
  textPattern?: RegExp;
}

export interface WaitVisibilityOptions extends WaitOptions {
  visibility?: VisibilityOptions;
}

export interface WaitIdleOptions extends WaitOptions {
  idle: IdleWindowOptions;
}

export interface WaitHelpers {
  waitFor(options: WaitForOptions): Promise<WaitResult>;
  waitText(options: WaitTextOptions): Promise<WaitResult>;
  waitVisible(options: WaitVisibilityOptions): Promise<WaitResult>;
  waitHidden(options: WaitVisibilityOptions): Promise<WaitResult>;
  waitForIdle(options: WaitIdleOptions): Promise<WaitResult>;
}

export function createWaitHelpers(dependencies: WaitHelpersDependencies): WaitHelpers {
  const {
    scheduler: providedScheduler,
    createScheduler: schedulerFactory,
    idleGate: providedIdleGate,
    createIdleGate: idleGateFactory,
    idleGateDependencies,
    idleGateTelemetry,
    ...rest
  } = dependencies;

  const schedulerDependencies: WaitSchedulerDependencies = {
    resolver: rest.resolver,
    logger: rest.logger,
    telemetry: rest.telemetry,
    clock: rest.clock,
    random: rest.random,
    sleep: rest.sleep
  };

  if (!schedulerDependencies.resolver) {
    throw new Error("createWaitHelpers requires a resolver dependency");
  }

  let schedulerInstance: WaitScheduler | null = providedScheduler ?? null;
  const resolveScheduler = (): WaitScheduler => {
    if (schedulerInstance) {
      return schedulerInstance;
    }

    const factory = schedulerFactory ?? createWaitScheduler;
    schedulerInstance = factory({ ...schedulerDependencies });
    return schedulerInstance;
  };

  let idleGateInstance: MutationIdleGateInstance | null = providedIdleGate ?? null;
  const resolveIdleGate = (): MutationIdleGateInstance => {
    if (idleGateInstance) {
      return idleGateInstance;
    }

    const factory = idleGateFactory ?? createMutationIdleGate;
    idleGateInstance = factory(idleGateDependencies);
    return idleGateInstance;
  };

  const logger: WaitLogger | undefined = schedulerDependencies.logger;

  const runWait = async (rawOptions: WaitOptions): Promise<WaitResult> => {
    const scheduler = resolveScheduler();
    const predicate = buildPredicate(rawOptions);
    const scrollIntegrationFactory = dependencies.createScrollIntegration ?? createWaitScrollIntegration;
    const scrollIntegration = scrollIntegrationFactory({
      resolver: schedulerDependencies.resolver,
      logger,
      sleep: schedulerDependencies.sleep
    }, rawOptions);

    const scheduleOptions: WaitScheduleOptions = {
      ...rawOptions,
      predicate,
      integration: scrollIntegration ?? undefined
    } satisfies WaitScheduleOptions;

    const sanitizeLogs = rawOptions.sanitizeLogs !== false;
    const debugEnabled = rawOptions.debug === true;
    const maskedKey = sanitizeText(rawOptions.key ?? null, sanitizeLogs) ?? undefined;
    const scrollerKey = rawOptions.scrollerKey ?? rawOptions.hints?.scrollerKey ?? null;
    const presenceThreshold = rawOptions.presenceThreshold ?? rawOptions.hints?.presenceThreshold;
    const maskedScrollerKey = sanitizeText(scrollerKey, sanitizeLogs) ?? scrollerKey ?? undefined;

    const debugPayload: Record<string, unknown> = {
      key: maskedKey,
      hasCss: Boolean(rawOptions.css),
      hasXpath: Boolean(rawOptions.xpath),
      hasText: Boolean(rawOptions.text ?? rawOptions.textPattern),
      visibilityTarget: rawOptions.visibility?.target,
      idleMs: rawOptions.idle?.idleMs,
      scopeKey: rawOptions.scopeKey,
      timeoutMs: rawOptions.timeoutMs,
      intervalMs: rawOptions.intervalMs,
      scrollerKey: maskedScrollerKey,
      presenceThreshold
    };

    if (debugEnabled) {
      logger?.debug?.("wait:start", debugPayload);
    }

    try {
      const result = await scheduler.waitFor(scheduleOptions);
      const finalResult = rawOptions.idle
        ? await runIdleGate(result, rawOptions)
        : result;

      if (debugEnabled) {
        logger?.debug?.("wait:success", {
          ...debugPayload,
          elapsedMs: finalResult.elapsedMs,
          pollCount: finalResult.pollCount,
          resolvedBy: finalResult.resolveResult.resolvedBy?.type,
          strategyHistory: finalResult.strategyHistory
        });
      }

      return finalResult;
    } catch (error) {
      if (debugEnabled) {
        logger?.debug?.("wait:error", {
          ...debugPayload,
          cause: error instanceof Error ? error.message : String(error)
        });
      }

      throw error;
    }
  };

  const runIdleGate = async (result: WaitResult, options: WaitOptions): Promise<WaitResult> => {
    if (!options.idle) {
      return result;
    }

    const gate = resolveIdleGate();
    const targets = result.target ? [result.target] : undefined;
    const root = resolveIdleRoot(result);

    const idleOptions: MutationIdleGateWaitOptions = {
      idle: options.idle,
      targets,
      root: root ?? undefined,
      signal: options.signal,
      telemetry: idleGateTelemetry ?? null
    };

    const idleResult: MutationIdleGateResult = await gate.waitForIdle(idleOptions);

    return {
      ...result,
      idleSnapshot: idleResult.snapshot
    } as WaitResult;
  };

  const waitFor = (options: WaitForOptions): Promise<WaitResult> => runWait(options);

  const waitText = (options: WaitTextOptions): Promise<WaitResult> => {
    if (!options.text && !options.textPattern) {
      throw new Error("waitText requires a text or textPattern option");
    }

    return runWait(options);
  };

  const waitVisible = (options: WaitVisibilityOptions): Promise<WaitResult> => {
    const visibility = {
      ...(options.visibility ?? {}),
      target: "visible" as const
    } as VisibilityOptions;

    return runWait({
      ...options,
      visibility
    });
  };

  const waitHidden = (options: WaitVisibilityOptions): Promise<WaitResult> => {
    const visibility = {
      ...(options.visibility ?? {}),
      target: "hidden" as const
    } as VisibilityOptions;

    return runWait({
      ...options,
      visibility
    });
  };

  const waitForIdle = (options: WaitIdleOptions): Promise<WaitResult> => {
    if (!options.idle) {
      throw new Error("waitForIdle requires idle options");
    }

    return runWait(options);
  };

  return {
    waitFor,
    waitText,
    waitVisible,
    waitHidden,
    waitForIdle
  } as WaitHelpers;

  function buildPredicate(options: WaitOptions): WaitPredicate | undefined {
    const predicates: WaitPredicate[] = [];

    if (options.text || options.textPattern) {
      const textConfig: TextPredicateConfig = {
        expected: options.text,
        pattern: options.textPattern,
        mode: options.textPattern ? "regex" : options.textMode,
        sanitize: options.sanitizeLogs !== false
      };

      predicates.push(createTextPredicate(textConfig));
    }

    if (options.visibility) {
      predicates.push(createVisibilityPredicate(options.visibility));
    }

    if (predicates.length === 0) {
      return undefined;
    }

    if (predicates.length === 1) {
      return predicates[0];
    }

    const combinedPredicate: WaitPredicate = async (context) => {
      let satisfied = true;
      let stale = false;
      let snapshot: WaitPredicateSnapshot | undefined;

      for (const predicate of predicates) {
        const result = await predicate(context);

        if (!result.satisfied) {
          satisfied = false;
        }

        if (result.stale) {
          stale = true;
        }

        if (result.snapshot) {
          snapshot = mergeSnapshots(snapshot, result.snapshot);
        }
      }

      return {
        satisfied: satisfied && !stale,
        stale,
        snapshot
      };
    };

    return combinedPredicate;
  }

  function mergeSnapshots(
    base: WaitPredicateSnapshot | undefined,
    extra: WaitPredicateSnapshot | undefined
  ): WaitPredicateSnapshot | undefined {
    if (!extra) {
      return base ? { ...base } : undefined;
    }

    if (!base) {
      return { ...extra };
    }

    return {
      ...base,
      ...extra,
      text: extra.text ?? base.text,
      visibility: extra.visibility ?? base.visibility,
      idle: extra.idle ?? base.idle,
      staleRecoveries: extra.staleRecoveries ?? base.staleRecoveries
    } as WaitPredicateSnapshot;
  }

  function resolveIdleRoot(
    result: WaitResult
  ): (Document | DocumentFragment | ShadowRoot | Element | null) {
    if (result.resolveResult.scope?.root) {
      return result.resolveResult.scope.root;
    }

    const candidate = result.target ?? result.resolveResult.element ?? null;

    if (candidate && typeof (candidate as Element).getRootNode === "function") {
      try {
        const rootNode = (candidate as Element).getRootNode();
        if (rootNode && typeof rootNode === "object") {
          return rootNode as Document | DocumentFragment | ShadowRoot | Element;
        }
      } catch {
        // ignore errors from getRootNode in non-DOM environments
      }
    }

    if (typeof Element !== "undefined" && candidate instanceof Element) {
      return candidate.ownerDocument ?? null;
    }

    return globalThis.document ?? null;
  }
}
