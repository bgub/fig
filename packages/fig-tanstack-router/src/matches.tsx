import {
  assets,
  createElement,
  ErrorBoundary,
  type FigNode,
  readContext,
  readPromise,
  Suspense,
  useBeforePaint,
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
} from "@bgub/fig";
import {
  type AnyRoute,
  type AnyRouteMatch,
  type AnyRouter,
  deepEqual,
  isNotFound,
  type RegisteredRouter,
  rootRouteId,
} from "@tanstack/router-core";
import { getScrollRestorationScriptForRouter } from "@tanstack/router-core/scroll-restoration-script";
import { dataStoreFromContext } from "./data-context.ts";
import {
  MatchContext,
  readRouterContext,
  RouterContext,
  useRouter,
} from "./hooks.tsx";
import {
  collectRouteAssets,
  collectRouterHeadTags,
  renderPositionedRouterTag,
  renderRouterHeadTags,
} from "./route-assets.ts";
import type { AsyncRouteComponent } from "./route.tsx";
import { useReadableStore } from "./store.ts";
import { settleTransition, Transitioner } from "./transitioner.tsx";

declare const __FIG_DEV__: boolean | undefined;

const __DEV__ = typeof __FIG_DEV__ === "boolean" ? __FIG_DEV__ : false;

export type RouterProviderProps<TRouter extends AnyRouter = RegisteredRouter> =
  Partial<Omit<TRouter["options"], "context">> & {
    context?: Partial<TRouter["options"]["context"]>;
    ownerDocument?: Document;
    router: TRouter;
  };

export function RouterProvider<TRouter extends AnyRouter = RegisteredRouter>({
  ownerDocument,
  router,
  ...options
}: RouterProviderProps<TRouter>): FigNode {
  const [, renderMatches] = useState<Array<AnyRouteMatch>>([]);
  if (Object.keys(options).length > 0) {
    if ("context" in options) {
      options.context = {
        ...router.options.context,
        ...options.context,
      };
    }
    router.update(options as never);
  }

  const manifest = router.ssr?.manifest;
  const contextValue = useMemo(
    () => ({ manifest, ownerDocument, router }),
    [manifest, ownerDocument, router],
  );
  const transitioner = router.isServer
    ? createElement(ServerTransitioner)
    : createElement(Transitioner, { render: renderMatches });

  return createElement(
    RouterContext,
    { value: contextValue },
    transitioner,
    createElement(Matches),
  );
}

function ServerTransitioner(): null {
  return null;
}

export function Matches(): FigNode {
  const router = useRouter<AnyRouter>();
  const currentMatches = useReadableStore(router.stores.matches);
  const acknowledgement = router._rendered;
  const matches = acknowledgement?.[0] ?? currentMatches;
  const firstRouteId = matches[0]?.routeId;
  useBeforePaint(() => {
    if (acknowledgement?.[0] === matches) {
      settleTransition(acknowledgement, true);
    }
    return undefined;
  }, [acknowledgement, matches]);
  const content =
    firstRouteId === undefined
      ? null
      : createElement(Match, { routeId: firstRouteId });
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

function Match({ routeId }: { routeId: string }): FigNode {
  const { manifest, router } = readRouterContext();
  const [manualResetKey, setManualResetKey] = useState(0);
  const store = router.stores.getMatchStore(routeId);
  const retained = useMemo(() => ({ match: store.get() }), [store]);
  const errorReset = useMemo(
    () => ({ controller: undefined as AbortController | undefined, key: 0 }),
    [],
  );
  const retainMatch = useCallback(
    (next: AnyRouteMatch | undefined) => {
      if (next !== undefined) retained.match = next;
      return retained.match;
    },
    [retained],
  );
  const match = useReadableStore(store, retainMatch);
  if (match === undefined) {
    throw new Error(`Could not find route match ${JSON.stringify(routeId)}.`);
  }
  const route = router.routesById[routeId];
  if (route === undefined) {
    throw new Error(`Could not find route ${JSON.stringify(match.routeId)}.`);
  }
  if (
    match.status === "error" &&
    errorReset.controller !== match.abortController
  ) {
    errorReset.controller = match.abortController;
    errorReset.key += 1;
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
    route.options.wrapInSuspense ??
    (noSsr ||
      (!route.isRoot &&
        (PendingComponent !== undefined ||
          (ErrorComponent as AsyncRouteComponent | undefined)?.preload !==
            undefined)));

  const pending = PendingComponent ? createElement(PendingComponent) : null;
  let content: FigNode = createElement(MatchContent, { match, route });
  if (noSsr) {
    content = createElement(ClientOnly, { fallback: pending }, content);
  }
  if (shouldWrapInSuspense) {
    content = createElement(Suspense, { fallback: pending }, content);
  }

  const matchContent = createElement(
    MatchContext,
    { value: { match, store } },
    ErrorComponent || NotFoundComponent
      ? createElement(
          ErrorBoundary,
          {
            key:
              match.status === "error"
                ? `route-error:${errorReset.key}`
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
                    const updatedMatch = router.stores
                      .getMatchStore(match.routeId)
                      .get();
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
  const matchAssets = collectRouteAssets(router, match, manifest).resources;
  const ownedMatchContent =
    matchAssets.length === 0 ? matchContent : assets(matchAssets, matchContent);

  if (route.parentRoute?.id !== rootRouteId) return ownedMatchContent;
  return [
    ownedMatchContent,
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

  if (match.status === "pending") {
    const loadPromise = router._tx?.[5];
    if (loadPromise !== undefined) readPromise(loadPromise);
    const PendingComponent =
      route.options.pendingComponent ?? router.options.defaultPendingComponent;
    return PendingComponent === undefined
      ? null
      : createElement(PendingComponent);
  }
  if (match.status === "error") {
    const ErrorComponent =
      route.options.errorComponent ?? router.options.defaultErrorComponent;
    if (router.isServer && ErrorComponent) {
      return createElement(ErrorComponent, {
        error: match.error,
        reset: doNothing,
      });
    }
    throw match.error;
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

function ClientOnly({
  children,
  fallback,
}: {
  children?: FigNode;
  fallback: FigNode;
}): FigNode {
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    hydratedSnapshot,
    serverHydrationSnapshot,
  );
  return hydrated ? children : fallback;
}

function subscribeHydration(): () => void {
  return doNothing;
}

function hydratedSnapshot(): boolean {
  return true;
}

function serverHydrationSnapshot(): boolean {
  return false;
}

function doNothing(): void {}

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
  const parentMatch = readContext(MatchContext)?.match;
  const routeIds = useReadableStore(router.stores.ids);
  const parentIndex = routeIds.indexOf(parentMatch?.routeId ?? "");
  if (parentMatch?._notFound === true) {
    const route = router.routesById[parentMatch.routeId];
    if (route === undefined) {
      throw new Error(
        `Could not find route ${JSON.stringify(parentMatch.routeId)}.`,
      );
    }
    return renderNotFound(router, route, parentMatch);
  }
  if (parentMatch !== undefined && parentIndex === -1) return null;
  const childRouteId = routeIds[parentIndex + 1];
  return childRouteId === undefined
    ? null
    : createElement(Match, { routeId: childRouteId });
}

export function HeadContent(): FigNode {
  const { manifest, ownerDocument, router } = readRouterContext();
  const selectTags = useCallback(
    (matches: AnyRouteMatch[]) =>
      collectRouterHeadTags(router, matches, manifest),
    [manifest, router],
  );
  const tags = useReadableStore(router.stores.matches, selectTags, deepEqual);
  return renderRouterHeadTags(tags, ownerDocument);
}

export function Scripts(): FigNode {
  const { manifest, router } = readRouterContext();
  const selectTags = useCallback(
    (matches: AnyRouteMatch[]) =>
      matches.flatMap(
        (match) => collectRouteAssets(router, match, manifest).scripts,
      ),
    [manifest, router],
  );
  const selectedTags = useReadableStore(
    router.stores.matches,
    selectTags,
    deepEqual,
  );
  const buffered = router.serverSsr?.takeBufferedScripts();
  const tags =
    buffered === undefined ? selectedTags : [buffered, ...selectedTags];
  return tags.map((tag) => renderPositionedRouterTag(tag));
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
