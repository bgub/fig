import { transition, useBeforePaint, useCallback, useMemo } from "@bgub/fig";
import type { RouterHistory } from "@tanstack/history";
import {
  type AnyRouter,
  getLocationChangeInfo,
  setupScrollRestoration,
} from "@tanstack/router-core";
import { batch } from "@tanstack/store";
import { useRouter } from "./hooks.tsx";

type HistoryUpdate = Parameters<Parameters<RouterHistory["subscribe"]>[0]>[0];

type RouterTransitionState = {
  active: boolean;
  generation: number;
  initialLoadStarted: boolean;
  phase: "idle" | "loading" | "loaded" | "mounting";
};

export function Transitioner(): null {
  const router = useRouter<AnyRouter>();
  const state = useMemo<RouterTransitionState>(
    () => ({
      active: false,
      generation: 0,
      initialLoadStarted: false,
      phase: "idle",
    }),
    [router],
  );
  const settleLifecycle = useCallback(() => {
    if (state.phase === "idle") return;
    const isLoading = router.stores.isLoading.get();
    const hasPending = router.stores.hasPending.get();
    const isTransitioning = router.stores.isTransitioning.get();
    const changeInfo = getLocationChangeInfo(
      router.stores.location.get(),
      router.stores.resolvedLocation.get(),
    );
    if (!isLoading && state.phase === "loading") {
      state.phase = "loaded";
      router.emit({ type: "onLoad", ...changeInfo });
    }
    if (!isLoading && !hasPending && state.phase === "loaded") {
      state.phase = "mounting";
      router.emit({ type: "onBeforeRouteMount", ...changeInfo });
    }
    if (!isLoading && !hasPending && !isTransitioning) {
      state.phase = "idle";
      router.emit({ type: "onResolved", ...changeInfo });
      batch(() => {
        router.stores.status.set("idle");
        router.stores.resolvedLocation.set(router.stores.location.get());
      });
    }
  }, [router, state]);
  const runRouterTransition = useCallback(
    (callback: () => void) => {
      const startsPending = !router.stores.isTransitioning.get();
      if (startsPending) router.stores.isTransitioning.set(true);

      let result: unknown;
      try {
        if (
          startsPending ||
          !router.stores.pendingMatches
            .get()
            .some((match) => match.status === "pending")
        ) {
          transition(() => {
            result = callback();
          });
        } else {
          result = callback();
        }
      } catch (error) {
        if (startsPending) router.stores.isTransitioning.set(false);
        throw error;
      }

      const promise = result as PromiseLike<unknown>;
      if (typeof promise?.then !== "function") {
        if (startsPending) router.stores.isTransitioning.set(false);
        return;
      }

      const generation = ++state.generation;
      state.phase = "loading";
      const finish = () => {
        if (state.active && state.generation === generation) {
          router.stores.isTransitioning.set(false);
        }
      };
      void promise.then(finish, (error: unknown) => {
        finish();
        queueMicrotask(() => {
          throw error;
        });
      });
    },
    [router, state],
  );
  const commitWithoutRouterViewTransition = useCallback(
    (commit: () => Promise<void>) => {
      router.shouldViewTransition = undefined;
      void commit();
    },
    [router],
  );

  useBeforePaint(
    (signal) => {
      const previousStartTransition = router.startTransition;
      const previousStartViewTransition = router.startViewTransition;
      const subscriptions = [
        router.stores.isLoading.subscribe(settleLifecycle),
        router.stores.hasPending.subscribe(settleLifecycle),
        router.stores.isTransitioning.subscribe(settleLifecycle),
      ];
      state.active = true;
      router.startTransition = runRouterTransition;
      router.startViewTransition = commitWithoutRouterViewTransition;
      signal.addEventListener(
        "abort",
        () => {
          for (const subscription of subscriptions) {
            subscription.unsubscribe();
          }
          state.active = false;
          state.generation += 1;
          if (router.startTransition === runRouterTransition) {
            router.startTransition = previousStartTransition;
          }
          if (
            router.startViewTransition === commitWithoutRouterViewTransition
          ) {
            router.startViewTransition = previousStartViewTransition;
          }
          if (router.stores.isTransitioning.get()) {
            router.stores.isTransitioning.set(false);
          }
        },
        { once: true },
      );
      return undefined;
    },
    [
      commitWithoutRouterViewTransition,
      router,
      runRouterTransition,
      settleLifecycle,
      state,
    ],
  );

  useBeforePaint(
    (signal) => {
      setupScrollRestoration(router);
      const unsubscribe = router.history.subscribe((update: HistoryUpdate) => {
        void router.load(update).catch(logRouterLoadError);
      });
      signal.addEventListener("abort", unsubscribe, { once: true });

      if (state.initialLoadStarted) return undefined;
      state.initialLoadStarted = true;
      const nextLocation = router.buildLocation({
        _includeValidateSearch: true,
        hash: true,
        params: true,
        search: true,
        state: true,
        to: router.latestLocation.pathname,
      });
      if (router.latestLocation.publicHref !== nextLocation.publicHref) {
        void router
          .commitLocation({ ...nextLocation, replace: true })
          .catch(logRouterLoadError);
      } else if (
        router.ssr === undefined &&
        router.stores.matchesId.get().length === 0
      ) {
        void router.load().catch(logRouterLoadError);
      }
      return undefined;
    },
    [router, router.history, router.options.scrollRestoration, state],
  );

  return null;
}

function logRouterLoadError(error: unknown): void {
  console.error("Error loading route", error);
}
