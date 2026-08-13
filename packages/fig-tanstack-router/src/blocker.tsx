import { useBeforePaint, useStableEvent, useState } from "@bgub/fig";
import type { HistoryAction, HistoryLocation } from "@tanstack/history";
import type {
  AnyRoute,
  AnyRouter,
  ParseRoute,
  RegisteredRouter,
} from "@tanstack/router-core";
import { useRouter } from "./hooks.tsx";
import { registerNavigationBlocker } from "./navigation-lifecycle.ts";

type BlockerLocation<
  out TRouteId = string,
  out TFullPath = string,
  out TParams = unknown,
  out TSearch = unknown,
> = {
  fullPath: TFullPath;
  params: TParams;
  pathname: string;
  routeId: TRouteId;
  search: TSearch;
};

type BlockerLocationUnion<
  TRouter extends AnyRouter = RegisteredRouter,
  TRoute extends AnyRoute = ParseRoute<TRouter["routeTree"]>,
> = TRoute extends AnyRoute
  ? BlockerLocation<
      TRoute["id"],
      TRoute["fullPath"],
      TRoute["types"]["allParams"],
      TRoute["types"]["fullSearchSchema"]
    >
  : never;

type BlockerResolver<TRouter extends AnyRouter = RegisteredRouter> =
  | {
      action: HistoryAction;
      current: BlockerLocationUnion<TRouter>;
      next: BlockerLocationUnion<TRouter>;
      proceed: () => void;
      reset: () => void;
      status: "blocked";
    }
  | {
      action: undefined;
      current: undefined;
      next: undefined;
      proceed: undefined;
      reset: undefined;
      status: "idle";
    };

type ShouldBlockArgs<TRouter extends AnyRouter> = {
  action: HistoryAction;
  current: BlockerLocationUnion<TRouter>;
  next: BlockerLocationUnion<TRouter>;
};

type PendingBlockerEvaluation<TRouter extends AnyRouter> =
  ShouldBlockArgs<TRouter> & {
    resolve?: (shouldBlock: boolean) => void;
  };

export type ShouldBlockFn<TRouter extends AnyRouter = RegisteredRouter> = (
  args: ShouldBlockArgs<TRouter>,
) => boolean | Promise<boolean>;

export type UseBlockerOpts<
  TRouter extends AnyRouter = RegisteredRouter,
  TWithResolver extends boolean = boolean,
> = {
  disabled?: boolean;
  enableBeforeUnload?: boolean | (() => boolean);
  shouldBlockFn: ShouldBlockFn<TRouter>;
  withResolver?: TWithResolver;
};

export function useBlocker<
  TRouter extends AnyRouter = RegisteredRouter,
  TWithResolver extends boolean = false,
>(
  options: UseBlockerOpts<TRouter, TWithResolver>,
): TWithResolver extends true ? BlockerResolver<TRouter> : void {
  const {
    disabled = false,
    enableBeforeUnload = true,
    shouldBlockFn,
    withResolver = false,
  } = options;
  const router = useRouter<TRouter>();
  const [resolver, setResolver] =
    useState<BlockerResolver<TRouter>>(idleBlockerResolver);
  const shouldBlock = useStableEvent((args: ShouldBlockArgs<TRouter>) =>
    shouldBlockFn(args),
  );
  const shouldEnableBeforeUnload = useStableEvent(() =>
    typeof enableBeforeUnload === "function"
      ? enableBeforeUnload()
      : enableBeforeUnload,
  );

  useBeforePaint(
    (signal) => {
      if (disabled) return undefined;
      const pendingEvaluations: Array<PendingBlockerEvaluation<TRouter>> = [];
      const publishDecision = (
        decision: PendingBlockerEvaluation<TRouter>,
      ): void => {
        if (decision.resolve === undefined) return;
        setResolver({
          action: decision.action,
          current: decision.current,
          next: decision.next,
          proceed: () => settleDecision(decision, false),
          reset: () => settleDecision(decision, true),
          status: "blocked",
        });
      };
      const publishNextDecision = (): void => {
        const nextEvaluation = pendingEvaluations[0];
        if (nextEvaluation?.resolve === undefined) {
          setResolver(idleBlockerResolver);
        } else {
          publishDecision(nextEvaluation);
        }
      };
      const discardEvaluation = (
        evaluation: PendingBlockerEvaluation<TRouter>,
      ): void => {
        const index = pendingEvaluations.indexOf(evaluation);
        if (index === -1) return;
        pendingEvaluations.splice(index, 1);
        if (index === 0) publishNextDecision();
      };
      const settleDecision = (
        decision: PendingBlockerEvaluation<TRouter>,
        shouldBlock: boolean,
      ): void => {
        const index = pendingEvaluations.indexOf(decision);
        if (index === -1) return;
        pendingEvaluations.splice(index, 1);
        decision.resolve?.(shouldBlock);
        if (index === 0) publishNextDecision();
      };
      const unregister = registerNavigationBlocker(router, {
        enableBeforeUnload: shouldEnableBeforeUnload,
        blockerFn: async (args) => {
          if (signal.aborted) return false;
          const current = blockerLocation(router, args.currentLocation);
          const next = blockerLocation(router, args.nextLocation);
          const evaluation: PendingBlockerEvaluation<TRouter> = {
            action: args.action,
            current,
            next,
          };
          if (withResolver) pendingEvaluations.push(evaluation);
          let blocked: boolean;
          try {
            blocked = await shouldBlock({
              action: args.action,
              current,
              next,
            });
          } catch (error) {
            if (withResolver) discardEvaluation(evaluation);
            if (signal.aborted) return false;
            throw error;
          }
          if (signal.aborted) return false;
          if (!withResolver) return blocked;
          if (!blocked) {
            discardEvaluation(evaluation);
            return false;
          }

          const resolved = await new Promise<boolean>((resolve) => {
            evaluation.resolve = resolve;
            if (pendingEvaluations[0] === evaluation) {
              publishDecision(evaluation);
            }
          });
          return resolved;
        },
      });
      signal.addEventListener(
        "abort",
        () => {
          unregister();
          const evaluations = pendingEvaluations.splice(0);
          for (const evaluation of evaluations) evaluation.resolve?.(false);
          if (evaluations.length > 0) setResolver(idleBlockerResolver);
        },
        { once: true },
      );
      return undefined;
    },
    [disabled, router, shouldBlock, shouldEnableBeforeUnload, withResolver],
  );

  return (withResolver ? resolver : undefined) as TWithResolver extends true
    ? BlockerResolver<TRouter>
    : void;
}

function blockerLocation<TRouter extends AnyRouter>(
  router: TRouter,
  location: HistoryLocation,
): BlockerLocationUnion<TRouter> {
  const parsed = router.parseLocation(location);
  const [, params, foundRoute] = router.getMatchedRoutes(parsed.pathname);
  return {
    fullPath: foundRoute?.fullPath ?? parsed.pathname,
    params,
    pathname: parsed.pathname,
    routeId: foundRoute?.id ?? "__notFound__",
    search: parsed.search,
  } as BlockerLocationUnion<TRouter>;
}

const idleBlockerResolver = {
  action: undefined,
  current: undefined,
  next: undefined,
  proceed: undefined,
  reset: undefined,
  status: "idle",
} as const;
