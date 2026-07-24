import {
  assets,
  createElement,
  ErrorBoundary,
  type FigNode,
  readContext,
  readPromise,
  Suspense,
  transition,
  useBeforePaint,
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
} from "@bgub/fig";
import type { HostIntrinsicElements } from "@bgub/fig-dom";
import type { RouterHistory } from "@tanstack/history";
import {
  type AnyRoute,
  type AnyRouteMatch,
  type AnyRouter,
  appendUniqueUserTags,
  createControlledPromise,
  deepEqual,
  escapeHtml,
  getLocationChangeInfo,
  isNotFound,
  type MetaDescriptor,
  type RegisteredRouter,
  type RouterManagedTag,
  rootRouteId,
  setupScrollRestoration,
} from "@tanstack/router-core";
import { getScrollRestorationScriptForRouter } from "@tanstack/router-core/scroll-restoration-script";
import { batch } from "@tanstack/store";
import { dataStoreFromContext } from "./data-context.ts";
import { MatchContext, RouterContext, useRouter } from "./hooks.tsx";
import {
  collectRouteAssets,
  renderPositionedRouterTag,
  renderRouterHeadTags,
} from "./route-assets.ts";
import type { AsyncRouteComponent } from "./route.tsx";
import { useReadableStore } from "./store.ts";

declare const __FIG_DEV__: boolean | undefined;

const __DEV__ = typeof __FIG_DEV__ === "boolean" ? __FIG_DEV__ : false;

declare module "@tanstack/router-core" {
  interface RouteMatchExtensions {
    headScripts?: Array<HostIntrinsicElements["script"] | undefined>;
    links?: Array<HostIntrinsicElements["link"] | undefined>;
    meta?: Array<HostIntrinsicElements["meta"] | MetaDescriptor | undefined>;
    scripts?: Array<HostIntrinsicElements["script"] | undefined>;
    styles?: Array<HostIntrinsicElements["style"] | undefined>;
  }
}

type HistoryUpdate = Parameters<Parameters<RouterHistory["subscribe"]>[0]>[0];

export type RouterProviderProps<TRouter extends AnyRouter = RegisteredRouter> =
  Partial<Omit<TRouter["options"], "context">> & {
    context?: Partial<TRouter["options"]["context"]>;
    router: TRouter;
  };

export function RouterProvider<TRouter extends AnyRouter = RegisteredRouter>({
  router,
  ...options
}: RouterProviderProps<TRouter>): FigNode {
  if (Object.keys(options).length > 0) {
    if ("context" in options) {
      options.context = {
        ...router.options.context,
        ...options.context,
      };
    }
    router.update(options as never);
  }

  return createElement(
    RouterContext,
    { value: router },
    createElement(Transitioner),
    createElement(Matches),
  );
}

type RouterTransitionState = {
  active: boolean;
  generation: number;
  initialLoadStarted: boolean;
  phase: "idle" | "loading" | "loaded" | "mounting";
};

function Transitioner(): FigNode {
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
        const publishesPending = router.stores.pendingMatches
          .get()
          .some((match) => match.status === "pending");
        if (startsPending || !publishesPending) {
          transition(() => {
            result = callback();
          });
        } else {
          result = callback();
        }
      } catch (error) {
        if (startsPending) {
          router.stores.isTransitioning.set(false);
        }
        throw error;
      }

      const promise = result as PromiseLike<unknown>;
      if (typeof promise?.then !== "function") {
        if (startsPending) {
          router.stores.isTransitioning.set(false);
        }
        return;
      }

      const generation = (state.generation += 1);
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
        !router.isServer &&
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

function OnRendered(): FigNode {
  const router = useRouter<AnyRouter>();
  type ResolvedLocation = ReturnType<typeof router.stores.resolvedLocation.get>;
  const state = useMemo<{ previous: ResolvedLocation }>(
    () => ({ previous: undefined }),
    [router],
  );
  const resolvedLocationKey = useReadableStore(
    router.stores.resolvedLocation,
    (location) => location?.state.__TSR_key,
  );

  useBeforePaint(() => {
    if (router.isServer) return undefined;
    const current = router.stores.resolvedLocation.get();
    const previous = state.previous;
    if (
      current !== undefined &&
      (previous === undefined || previous.href !== current.href)
    ) {
      router.emit({
        type: "onRendered",
        ...getLocationChangeInfo(
          router.stores.location.get(),
          previous ?? current,
        ),
      });
    }
    state.previous = current;
    return undefined;
  }, [resolvedLocationKey, router, state]);

  return null;
}

export function Matches(): FigNode {
  const router = useRouter<AnyRouter>();
  const firstMatchId = useReadableStore(router.stores.firstId);
  const content =
    firstMatchId === undefined
      ? null
      : createElement(Match, { matchId: firstMatchId });
  if (router.isServer || router.ssr !== undefined) return content;

  const rootRoute = router.routesById[rootRouteId];
  const PendingComponent =
    rootRoute.options.pendingComponent ??
    router.options.defaultPendingComponent;
  return createElement(
    Suspense,
    {
      fallback:
        PendingComponent === undefined ? null : createElement(PendingComponent),
    },
    content,
  );
}

function Match({ matchId }: { matchId: string }): FigNode {
  const router = useRouter<AnyRouter>();
  const [manualResetKey, setManualResetKey] = useState(0);
  const store = router.stores.matchStores.get(matchId);
  if (store === undefined) {
    throw new Error(`Could not find route match ${JSON.stringify(matchId)}.`);
  }
  const match = useReadableStore(store);
  const route = router.routesById[match.routeId];
  if (route === undefined) {
    throw new Error(`Could not find route ${JSON.stringify(match.routeId)}.`);
  }
  if (
    __DEV__ &&
    match.loaderData !== undefined &&
    dataStoreFromContext(match.context) !== undefined
  ) {
    throw new Error(
      `Route ${JSON.stringify(match.routeId)} loader returned a value while ` +
        "router.context.data is configured. Fig data resources are the single " +
        "route-data cache: load with ensureRouteData or " +
        "context.data.preloadData in the loader, read with readData in the " +
        "component, and return void. For navigation-scoped values, derive " +
        "them from loaderDeps, search params, or beforeLoad context instead.",
    );
  }

  const PendingComponent =
    route.options.pendingComponent ?? router.options.defaultPendingComponent;
  const ErrorComponent =
    route.options.errorComponent ?? router.options.defaultErrorComponent;
  const NotFoundComponent =
    route.options.notFoundComponent ??
    (route.isRoot ? router.options.defaultNotFoundComponent : undefined);
  const noSsr = match.ssr === false || match.ssr === "data-only";
  const shouldWrapInSuspense =
    (!route.isRoot || route.options.wrapInSuspense || noSsr) &&
    (route.options.wrapInSuspense ??
      (PendingComponent !== undefined ||
        (ErrorComponent as AsyncRouteComponent | undefined)?.preload ||
        noSsr));

  const pending = PendingComponent ? createElement(PendingComponent) : null;
  let content: FigNode = createElement(MatchContent, { match, route });
  if (noSsr || match._displayPending) {
    content = createElement(ClientOnly, { fallback: pending }, content);
  }
  if (shouldWrapInSuspense) {
    content = createElement(Suspense, { fallback: pending }, content);
  }

  const matchContent = createElement(
    MatchContext,
    { value: store },
    ErrorComponent || NotFoundComponent
      ? createElement(
          ErrorBoundary,
          {
            key:
              match.status === "error"
                ? `route-error:${match.fetchCount}`
                : `route:${manualResetKey}`,
            fallback: (error) => {
              if (isNotFound(error)) {
                error.routeId ??= match.routeId;
                if (
                  NotFoundComponent === undefined ||
                  error.routeId !== match.routeId
                ) {
                  throw error;
                }
                return createElement(NotFoundComponent, {
                  ...error,
                  isNotFound: true,
                });
              }
              if (!ErrorComponent) throw error;
              return createElement(ErrorComponent, {
                error,
                reset: () => {
                  dataStoreFromContext(match.context)?.invalidateDataError(
                    error,
                  );
                  void router.invalidate().then(() => {
                    const updatedMatch = router.stores.matchStores
                      .get(match.id)
                      ?.get();
                    if (updatedMatch?.status !== "error") {
                      setManualResetKey((key) => key + 1);
                    }
                  });
                },
              });
            },
            onError: (error, info) => {
              if (!isNotFound(error)) {
                if (route.options.onCatch) {
                  route.options.onCatch(error as Error);
                } else {
                  router.options.defaultOnCatch?.(error as Error, info);
                }
              }
            },
          },
          content,
        )
      : content,
  );
  const matchAssets = collectRouteAssets(
    router,
    match,
    router.ssr?.manifest,
  ).resources;
  const ownedMatchContent =
    matchAssets.length === 0 ? matchContent : assets(matchAssets, matchContent);

  if (route.parentRoute?.id !== rootRouteId) return ownedMatchContent;
  return [
    ownedMatchContent,
    createElement(OnRendered),
    router.options.scrollRestoration && router.isServer
      ? renderScrollRestorationScript(router)
      : null,
  ];
}

function MatchContent({
  match,
  route,
}: {
  match: AnyRouteMatch;
  route: AnyRoute;
}): FigNode {
  const router = useRouter<AnyRouter>();

  if (match._displayPending)
    return readMatchPromise(router, match, "displayPendingPromise");
  if (match._forcePending)
    return readMatchPromise(router, match, "minPendingPromise");
  if (match.status === "pending") {
    const pendingMinMs =
      route.options.pendingMinMs ?? router.options.defaultPendingMinMs;
    const PendingComponent =
      route.options.pendingComponent ?? router.options.defaultPendingComponent;
    const currentMatch = router.getMatch(match.id);
    if (
      pendingMinMs &&
      PendingComponent &&
      !router.isServer &&
      currentMatch !== undefined &&
      currentMatch._nonReactive.minPendingPromise === undefined
    ) {
      const minPendingPromise = createControlledPromise<void>();
      currentMatch._nonReactive.minPendingPromise = minPendingPromise;
      setTimeout(() => {
        minPendingPromise.resolve();
        currentMatch._nonReactive.minPendingPromise = undefined;
      }, pendingMinMs);
    }
    return readMatchPromise(router, match, "loadPromise");
  }
  if (match.status === "error") {
    const ErrorComponent =
      route.options.errorComponent ?? router.options.defaultErrorComponent;
    if (router.isServer && ErrorComponent) {
      return createElement(ErrorComponent, {
        error: match.error,
        reset: () => undefined,
      });
    }
    throw match.error;
  }
  if (match.status === "redirected") {
    return readMatchPromise(router, match, "loadPromise");
  }
  if (match.status === "notFound") return renderNotFound(router, route, match);

  const Component = route.options.component ?? router.options.defaultComponent;
  const remount =
    route.options.remountDeps ?? router.options.defaultRemountDeps;
  const remountDeps = remount?.({
    loaderDeps: match.loaderDeps,
    params: match._strictParams,
    routeId: match.routeId,
    search: match._strictSearch,
  });
  return Component === undefined
    ? createElement(Outlet)
    : createElement(Component, {
        key: remountDeps ? JSON.stringify(remountDeps) : undefined,
      });
}

type MatchPromiseKey =
  | "displayPendingPromise"
  | "loadPromise"
  | "minPendingPromise";

function readMatchPromise(
  router: AnyRouter,
  match: AnyRouteMatch,
  key: MatchPromiseKey,
): FigNode {
  const promise =
    router.getMatch(match.id)?._nonReactive[key] ?? match._nonReactive[key];
  if (promise !== undefined) readPromise(promise);
  return null;
}

function ClientOnly({
  children,
  fallback,
}: {
  children?: FigNode;
  fallback: FigNode;
}): FigNode {
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    () => true,
    () => false,
  );
  return hydrated ? children : fallback;
}

function subscribeHydration(): () => void {
  return () => undefined;
}

function renderScrollRestorationScript(router: AnyRouter): FigNode {
  const script = getScrollRestorationScriptForRouter(router);
  return script === null
    ? null
    : renderPositionedRouterTag({
        attrs: { nonce: router.options.ssr?.nonce },
        children: `${script};document.currentScript.remove()`,
        tag: "script",
      });
}

export function Outlet(): FigNode {
  const router = useRouter<AnyRouter>();
  const parentMatchStore = readContext(MatchContext);
  const parentMatch = parentMatchStore?.get();
  const matchIds = useReadableStore(router.stores.matchesId);
  const parentIndex = matchIds.findIndex((id) => id === parentMatch?.id);
  if (parentMatch?.globalNotFound === true) {
    const route = router.routesById[parentMatch.routeId];
    if (route === undefined) {
      throw new Error(
        `Could not find route ${JSON.stringify(parentMatch.routeId)}.`,
      );
    }
    return renderNotFound(router, route, parentMatch);
  }
  if (parentMatch !== undefined && parentIndex === -1) return null;
  const childMatchId = matchIds[parentIndex + 1];
  return childMatchId === undefined
    ? null
    : createElement(Match, { matchId: childMatchId });
}

export function HeadContent(): FigNode {
  const router = useRouter<AnyRouter>();
  const selectTags = useCallback(
    (matches: AnyRouteMatch[]) => buildHeadTags(router, matches),
    [router],
  );
  const tags = useReadableStore(router.stores.matches, selectTags, deepEqual);
  return renderRouterHeadTags(tags);
}

export function Scripts(): FigNode {
  const router = useRouter<AnyRouter>();
  const selectTags = useCallback(
    (matches: AnyRouteMatch[]) =>
      matches.flatMap(
        (match) =>
          collectRouteAssets(router, match, router.ssr?.manifest).scripts,
      ),
    [router],
  );
  const selectedTags = useReadableStore(
    router.stores.matches,
    selectTags,
    deepEqual,
  );
  const tags = [...selectedTags];

  const buffered = router.serverSsr?.takeBufferedScripts();
  if (buffered !== undefined) tags.unshift(buffered);
  return tags.map(renderPositionedRouterTag);
}

function buildHeadTags(
  router: AnyRouter,
  matches: AnyRouteMatch[],
): RouterManagedTag[] {
  const nonce = router.options.ssr?.nonce;
  const manifest = router.ssr?.manifest;
  const metaTags: RouterManagedTag[] = [];
  const seenMeta = new Set<string>();
  let selectedTitle: RouterManagedTag | undefined;

  for (let matchIndex = matches.length - 1; matchIndex >= 0; matchIndex -= 1) {
    const routeMeta = matches[matchIndex]?.meta ?? [];
    for (let metaIndex = routeMeta.length - 1; metaIndex >= 0; metaIndex -= 1) {
      const value = routeMeta[metaIndex];
      if (value === undefined) continue;
      const title =
        "title" in value && typeof value.title === "string"
          ? value.title
          : undefined;
      if (title !== undefined) {
        selectedTitle ??= { tag: "title", children: title };
        continue;
      }
      if ("script:ld+json" in value) {
        try {
          metaTags.push({
            tag: "script",
            attrs: { type: "application/ld+json" },
            children: escapeHtml(JSON.stringify(value["script:ld+json"])),
          });
        } catch {
          // Invalid JSON-LD is omitted, matching TanStack Router's adapters.
        }
        continue;
      }
      const identity =
        ("name" in value && typeof value.name === "string"
          ? value.name
          : undefined) ??
        ("property" in value && typeof value.property === "string"
          ? value.property
          : undefined);
      if (identity !== undefined) {
        if (seenMeta.has(identity)) continue;
        seenMeta.add(identity);
      }
      metaTags.push({ tag: "meta", attrs: { ...value, nonce } });
    }
  }
  if (selectedTitle !== undefined) metaTags.push(selectedTitle);
  if (nonce !== undefined) {
    metaTags.push({
      tag: "meta",
      attrs: { content: nonce, property: "csp-nonce" },
    });
  }
  metaTags.reverse();

  const tags: RouterManagedTag[] = [];
  appendUniqueUserTags(tags, metaTags);
  appendUniqueUserTags(
    tags,
    matches.flatMap(
      (match) => collectRouteAssets(router, match, manifest).links,
    ),
  );
  if (manifest?.inlineStyle !== undefined) {
    tags.push({
      tag: "style",
      attrs: { ...manifest.inlineStyle.attrs, nonce },
      children: manifest.inlineStyle.children,
      inlineCss: true,
    });
  }
  appendUniqueUserTags(
    tags,
    matches.flatMap((match) =>
      (match.styles ?? [])
        .filter((style) => style !== undefined)
        .map(({ children, ...attrs }) => ({
          tag: "style" as const,
          attrs: { ...attrs, nonce },
          children: children as string | undefined,
        })),
    ),
  );
  appendUniqueUserTags(
    tags,
    matches.flatMap(
      (match) => collectRouteAssets(router, match, manifest).headScripts,
    ),
  );
  return tags;
}

function renderNotFound(
  router: AnyRouter,
  route: AnyRoute,
  match: AnyRouteMatch,
): FigNode {
  const NotFoundComponent =
    route.options.notFoundComponent ?? router.options.defaultNotFoundComponent;
  return NotFoundComponent === undefined
    ? null
    : createElement(NotFoundComponent, {
        data: match.error,
        isNotFound: true,
        routeId: match.routeId,
      });
}
