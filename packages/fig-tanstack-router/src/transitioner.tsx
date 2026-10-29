import { transition, useBeforePaint, useCallback } from "@bgub/fig";
import type { RouterHistory } from "@tanstack/history";
import {
  type AnyRouteMatch,
  type AnyRouter,
  getLocationChangeInfo,
  setupScrollRestoration,
  trimPathRight,
} from "@tanstack/router-core";
import { useRouter } from "./hooks.tsx";

type HistoryUpdate = Parameters<Parameters<RouterHistory["subscribe"]>[0]>[0];
type TransitionRouter = AnyRouter & { _cancelTransition?: () => void };

export function settleTransition(
  acknowledgement: NonNullable<AnyRouter["_rendered"]>,
  rendered: boolean,
): void {
  const settle = acknowledgement[1];
  acknowledgement.length = 0;
  settle?.(rendered);
}

export function Transitioner({
  render,
}: {
  render: (matches: Array<AnyRouteMatch>) => void;
}): null {
  const router = useRouter<AnyRouter>() as TransitionRouter;
  const acknowledgement = (router._rendered ??= []);
  const startTransition = useCallback(
    (callback: () => void, expected: Array<AnyRouteMatch>) =>
      new Promise<boolean>((resolve, reject) => {
        settleTransition(acknowledgement, false);
        acknowledgement.push(expected, resolve);
        transition(() => {
          try {
            render(expected);
            callback();
          } catch (error) {
            if (acknowledgement[1] === resolve) acknowledgement.length = 0;
            reject(error);
          }
        });
      }),
    [acknowledgement, render],
  );
  const cancelTransition = useCallback(
    () => settleTransition(acknowledgement, false),
    [acknowledgement],
  );
  const commitWithoutRouterViewTransition = useCallback(
    (commit: () => Promise<void>) => {
      router.shouldViewTransition = undefined;
      return commit();
    },
    [router],
  );

  useBeforePaint(
    (signal) => {
      const previousStartTransition = router.startTransition;
      const previousStartViewTransition = router.startViewTransition;
      const previousCancelTransition = router._cancelTransition;
      router.startTransition = startTransition;
      router.startViewTransition = commitWithoutRouterViewTransition;
      router._cancelTransition = cancelTransition;
      signal.addEventListener(
        "abort",
        () => {
          cancelTransition();
          if (router.startTransition === startTransition) {
            router.startTransition = previousStartTransition;
          }
          if (
            router.startViewTransition === commitWithoutRouterViewTransition
          ) {
            router.startViewTransition = previousStartViewTransition;
          }
          if (router._cancelTransition === cancelTransition) {
            router._cancelTransition = previousCancelTransition;
          }
        },
        { once: true },
      );
      return undefined;
    },
    [
      cancelTransition,
      commitWithoutRouterViewTransition,
      router,
      startTransition,
    ],
  );

  useBeforePaint(
    (signal) => {
      setupScrollRestoration(router);
      const unsubscribe = router.history.subscribe((update: HistoryUpdate) => {
        void router.load(update).catch(logRouterLoadError);
      });
      signal.addEventListener("abort", unsubscribe, { once: true });

      router.updateLatestLocation();
      const location = router.latestLocation;
      const nextLocation = router.buildLocation({
        _includeValidateSearch: true,
        hash: true,
        params: true,
        search: true,
        state: true,
        to: location.pathname,
      });
      if (
        trimPathRight(location.publicHref) !==
        trimPathRight(nextLocation.publicHref)
      ) {
        void router
          .commitLocation({
            ...nextLocation,
            ignoreBlocker: true,
            replace: true,
          })
          .catch(logRouterLoadError);
        return undefined;
      }

      const resolvedLocation = router.stores.resolvedLocation.get();
      if (
        resolvedLocation?.href === location.href &&
        resolvedLocation.state.__TSR_key === location.state.__TSR_key
      ) {
        acknowledgement.push(router.stores.matches.get(), (rendered) => {
          if (rendered) {
            router.emit({
              type: "onRendered",
              ...getLocationChangeInfo(resolvedLocation, resolvedLocation),
            });
          }
        });
      } else if (router.ssr === undefined && !router._tx) {
        void router.load().catch(logRouterLoadError);
      }
      return undefined;
    },
    [acknowledgement, router, router.history],
  );

  return null;
}

function logRouterLoadError(error: unknown): void {
  console.error("Error loading route", error);
}
