import {
  createContext,
  createElement,
  type ComponentType,
  type DataResource,
  ErrorBoundary,
  type FigDataStoreHandle,
  type FigNode,
  readContext,
  Suspense,
  transition,
  useBeforePaint,
  useCallback,
  useMemo,
  useReactive,
  useState,
  useSyncExternalStore,
} from "@bgub/fig";
import { composeBind, type HostIntrinsicElements, on } from "@bgub/fig-dom";
import {
  createBrowserHistory,
  createHashHistory,
  createMemoryHistory,
  type HistoryAction,
  type RouterHistory,
} from "@tanstack/history";
import {
  type AnyContext,
  type AnyRoute,
  type AnyRouteMatch,
  type AnyRouter,
  BaseRootRoute,
  BaseRoute,
  deepEqual,
  exactPathTest,
  getLocationChangeInfo,
  isDangerousProtocol,
  type LinkOptions,
  type NotFoundRouteProps,
  removeTrailingSlash,
  type RegisteredRouter,
  type Register,
  type ResolveFullPath,
  type ResolveId,
  type ResolveUseLoaderData,
  type ResolveUseParams,
  type ResolveUseSearch,
  type ResolveParams,
  type RootRouteOptions,
  RouterCore,
  type RouterConstructorOptions,
  type RouterReadableStore,
  type RouterState,
  type RouteConstraints,
  type RouteIds,
  type RouteOptions,
  type TrailingSlashOption,
  type UseRouteContextResult,
} from "@tanstack/router-core";
import { batch } from "@tanstack/store";
import { getStoreConfig } from "./store.ts";

export { createBrowserHistory, createHashHistory, createMemoryHistory };
export {
  defaultParseSearch,
  defaultStringifySearch,
  isNotFound,
  isRedirect,
  notFound,
  parseSearchWith,
  redirect,
  retainSearchParams,
  rootRouteId,
  stringifySearchWith,
  stripSearchParams,
} from "@tanstack/router-core";
export type {
  AnyRoute,
  AnyRouteMatch,
  AnyRouter,
  LinkOptions,
  NavigateOptions,
  ParsedLocation,
  RegisteredRouter,
  RouterState,
} from "@tanstack/router-core";
export type { RouterHistory } from "@tanstack/history";

export interface RouteErrorComponentProps {
  error: unknown;
  reset: () => void;
}

export interface RouteDataContext {
  data: FigDataStoreHandle;
}

export async function ensureRouteData<TArgs extends unknown[], TValue>(
  context: RouteDataContext,
  resource: DataResource<TArgs, TValue>,
  ...args: TArgs
): Promise<void> {
  await context.data.ensureData(resource, ...args);
}

export type RouteComponent = ComponentType;
export type ErrorRouteComponent = ComponentType<RouteErrorComponentProps>;
export type NotFoundRouteComponent = ComponentType<NotFoundRouteProps>;

declare module "@tanstack/router-core" {
  interface UpdatableRouteOptionsExtensions {
    component?: RouteComponent;
    errorComponent?: false | null | ErrorRouteComponent;
    notFoundComponent?: NotFoundRouteComponent;
    pendingComponent?: RouteComponent;
  }

  interface RouterOptionsExtensions {
    defaultComponent?: RouteComponent;
    defaultErrorComponent?: ErrorRouteComponent;
    defaultNotFoundComponent?: NotFoundRouteComponent;
    defaultPendingComponent?: RouteComponent;
  }
}

export class Router<
  in out TRouteTree extends AnyRoute,
  in out TTrailingSlashOption extends TrailingSlashOption = "never",
  in out TDefaultStructuralSharingOption extends boolean = false,
  in out TRouterHistory extends RouterHistory = RouterHistory,
  in out TDehydrated extends Record<string, unknown> = Record<string, unknown>,
> extends RouterCore<
  TRouteTree,
  TTrailingSlashOption,
  TDefaultStructuralSharingOption,
  TRouterHistory,
  TDehydrated
> {
  constructor(
    options: RouterConstructorOptions<
      TRouteTree,
      TTrailingSlashOption,
      TDefaultStructuralSharingOption,
      TRouterHistory,
      TDehydrated
    >,
  ) {
    super(
      options.defaultPreloadStaleTime === undefined &&
        dataStoreFromContext(options.context) !== null
        ? { ...options, defaultPreloadStaleTime: 0 }
        : options,
      getStoreConfig,
    );
  }
}

export function createRouter<
  TRouteTree extends AnyRoute,
  TTrailingSlashOption extends TrailingSlashOption = "never",
  TDefaultStructuralSharingOption extends boolean = false,
  TRouterHistory extends RouterHistory = RouterHistory,
  TDehydrated extends Record<string, unknown> = Record<string, unknown>,
>(
  options: RouterConstructorOptions<
    TRouteTree,
    TTrailingSlashOption,
    TDefaultStructuralSharingOption,
    TRouterHistory,
    TDehydrated
  >,
) {
  return new Router(options);
}

export function createRoute<
  TRegister = unknown,
  TParentRoute extends RouteConstraints["TParentRoute"] = AnyRoute,
  TPath extends RouteConstraints["TPath"] = "/",
  TFullPath extends RouteConstraints["TFullPath"] = ResolveFullPath<
    TParentRoute,
    TPath
  >,
  TCustomId extends RouteConstraints["TCustomId"] = string,
  TId extends RouteConstraints["TId"] = ResolveId<
    TParentRoute,
    TCustomId,
    TPath
  >,
  TSearchValidator = undefined,
  TParams = ResolveParams<TPath>,
  TRouteContextFn = AnyContext,
  TBeforeLoadFn = AnyContext,
  TLoaderDeps extends Record<string, unknown> = {},
  TLoaderFn = undefined,
  TChildren = unknown,
  TSSR = unknown,
  const TServerMiddlewares = unknown,
>(
  options: RouteOptions<
    TRegister,
    TParentRoute,
    TId,
    TCustomId,
    TFullPath,
    TPath,
    TSearchValidator,
    TParams,
    TLoaderDeps,
    TLoaderFn,
    AnyContext,
    TRouteContextFn,
    TBeforeLoadFn,
    TSSR,
    TServerMiddlewares
  >,
): BaseRoute<
  TRegister,
  TParentRoute,
  TPath,
  TFullPath,
  TCustomId,
  TId,
  TSearchValidator,
  TParams,
  AnyContext,
  TRouteContextFn,
  TBeforeLoadFn,
  TLoaderDeps,
  TLoaderFn,
  TChildren,
  unknown,
  TSSR,
  TServerMiddlewares
> {
  return new BaseRoute(options);
}

export function createRootRoute<
  TRegister = Register,
  TSearchValidator = undefined,
  TRouterContext = {},
  TRouteContextFn = AnyContext,
  TBeforeLoadFn = AnyContext,
  TLoaderDeps extends Record<string, unknown> = {},
  TLoaderFn = undefined,
  TSSR = unknown,
  const TServerMiddlewares = unknown,
  THandlers = undefined,
>(
  options?: RootRouteOptions<
    TRegister,
    TSearchValidator,
    TRouterContext,
    TRouteContextFn,
    TBeforeLoadFn,
    TLoaderDeps,
    TLoaderFn,
    TSSR,
    TServerMiddlewares,
    THandlers
  >,
): BaseRootRoute<
  TRegister,
  TSearchValidator,
  TRouterContext,
  TRouteContextFn,
  TBeforeLoadFn,
  TLoaderDeps,
  TLoaderFn,
  unknown,
  unknown,
  TSSR,
  TServerMiddlewares,
  THandlers
> {
  return new BaseRootRoute(options);
}

export function createRootRouteWithContext<TRouterContext extends object>() {
  return <
    TRegister = Register,
    TRouteContextFn = AnyContext,
    TBeforeLoadFn = AnyContext,
    TSearchValidator = undefined,
    TLoaderDeps extends Record<string, unknown> = {},
    TLoaderFn = undefined,
    TSSR = unknown,
    TServerMiddlewares = unknown,
  >(
    options?: RootRouteOptions<
      TRegister,
      TSearchValidator,
      TRouterContext,
      TRouteContextFn,
      TBeforeLoadFn,
      TLoaderDeps,
      TLoaderFn,
      TSSR,
      TServerMiddlewares
    >,
  ) => createRootRoute(options);
}

const RouterContext = createContext<AnyRouter | null>(null);
const MatchContext = createContext<string | null>(null);
const initialLoads = new WeakSet<AnyRouter>();
const missingMatch = Symbol("missing route match");

interface HistoryUpdate {
  action: { type: HistoryAction };
}

export function useRouter<
  TRouter extends AnyRouter = RegisteredRouter,
>(): TRouter;
export function useRouter(): unknown {
  return requireRouter(readContext(RouterContext));
}

function requireRouter(router: AnyRouter | null): AnyRouter {
  if (router === null) {
    throw new Error("Router hooks must be used inside <RouterProvider>.");
  }
  return router;
}

interface UseRouterStateOptions<TRouter extends AnyRouter, TSelected> {
  router?: TRouter;
  select: (state: RouterState<TRouter["routeTree"]>) => TSelected;
}

export function useRouterState<
  TRouter extends AnyRouter = RegisteredRouter,
>(): RouterState<TRouter["routeTree"]>;
export function useRouterState<
  TRouter extends AnyRouter = RegisteredRouter,
  TSelected = unknown,
>(options: UseRouterStateOptions<TRouter, TSelected>): TSelected;
export function useRouterState(
  options?: UseRouterStateOptions<AnyRouter, unknown>,
): unknown {
  const router = requireRouter(options?.router ?? readContext(RouterContext));
  const select = options?.select ?? selectRouterState;
  return useReadableStore(router.stores.__store, select);
}

function selectRouterState(
  state: RouterState<AnyRoute>,
): RouterState<AnyRoute> {
  return state;
}

export function useLocation<
  TRouter extends AnyRouter = RegisteredRouter,
>(): RouterState<TRouter["routeTree"]>["location"] {
  return useReadableStore(useRouter<TRouter>().stores.location);
}

interface MatchOptions<TSelected> {
  from?: string;
  select?: (match: AnyRouteMatch) => TSelected;
}

interface FromRouteOptions<TFrom extends string> {
  from: TFrom;
}

export function useMatch(options?: MatchOptions<AnyRouteMatch>): AnyRouteMatch;
export function useMatch<TSelected>(
  options: MatchOptions<TSelected> & {
    select: (match: AnyRouteMatch) => TSelected;
  },
): TSelected;
export function useMatch(options?: MatchOptions<unknown>): unknown {
  const router = useRouter<AnyRouter>();
  const nearestMatchId = readContext(MatchContext);
  const store = options?.from
    ? router.stores.getRouteMatchStore(options.from)
    : nearestMatchId === null
      ? undefined
      : router.stores.matchStores.get(nearestMatchId);

  if (store === undefined) throwMissingMatch(options?.from);

  const selected = useReadableStore(store, (match) => {
    if (match === undefined) return missingMatch;
    return options?.select === undefined ? match : options.select(match);
  });
  if (selected === missingMatch) throwMissingMatch(options?.from);
  return selected;
}

function throwMissingMatch(from?: string): never {
  const target = from ? `route ${JSON.stringify(from)}` : "the nearest route";
  throw new Error(`Could not find an active match for ${target}.`);
}

export function useParams(): AnyRouteMatch["params"];
export function useParams<
  TRouter extends AnyRouter = RegisteredRouter,
  const TFrom extends RouteIds<TRouter["routeTree"]> = RouteIds<
    TRouter["routeTree"]
  >,
>(options: FromRouteOptions<TFrom>): ResolveUseParams<TRouter, TFrom, true>;
export function useParams(options?: FromRouteOptions<string>): unknown {
  return useMatch({ from: options?.from, select: (match) => match.params });
}

export function useSearch(): AnyRouteMatch["search"];
export function useSearch<
  TRouter extends AnyRouter = RegisteredRouter,
  const TFrom extends RouteIds<TRouter["routeTree"]> = RouteIds<
    TRouter["routeTree"]
  >,
>(options: FromRouteOptions<TFrom>): ResolveUseSearch<TRouter, TFrom, true>;
export function useSearch(options?: FromRouteOptions<string>): unknown {
  return useMatch({ from: options?.from, select: (match) => match.search });
}

export function useLoaderData(): AnyRouteMatch["loaderData"];
export function useLoaderData<
  TRouter extends AnyRouter = RegisteredRouter,
  const TFrom extends RouteIds<TRouter["routeTree"]> = RouteIds<
    TRouter["routeTree"]
  >,
>(options: FromRouteOptions<TFrom>): ResolveUseLoaderData<TRouter, TFrom, true>;
export function useLoaderData(options?: FromRouteOptions<string>): unknown {
  return useMatch({ from: options?.from, select: (match) => match.loaderData });
}

export function useRouteContext(): AnyRouteMatch["context"];
export function useRouteContext<
  TRouter extends AnyRouter = RegisteredRouter,
  const TFrom extends RouteIds<TRouter["routeTree"]> = RouteIds<
    TRouter["routeTree"]
  >,
>(
  options: FromRouteOptions<TFrom>,
): UseRouteContextResult<TRouter, TFrom, true, unknown>;
export function useRouteContext(options?: FromRouteOptions<string>): unknown {
  return useMatch({ from: options?.from, select: (match) => match.context });
}

export function useNavigate<
  TRouter extends AnyRouter = RegisteredRouter,
>(): TRouter["navigate"] {
  const router = useRouter<TRouter>();
  return router.navigate;
}

export interface RouterProviderProps {
  router: AnyRouter;
}

export function RouterProvider({ router }: RouterProviderProps): FigNode {
  return createElement(
    RouterContext,
    { value: router },
    createElement(Transitioner),
    createElement(Matches),
  );
}

function Transitioner(): FigNode {
  const router = useRouter<AnyRouter>();

  router.startTransition = (callback) => {
    transition(callback);
  };

  useReactive(
    (signal) => {
      const unsubscribe = router.history.subscribe((update: HistoryUpdate) => {
        void loadAndSettleRouter(router, update).catch((error: unknown) => {
          console.error("Error loading route", error);
        });
      });
      signal.addEventListener("abort", unsubscribe, { once: true });
    },
    [router, router.history],
  );

  useBeforePaint(() => {
    if (router.stores.matchesId.get().length === 0) {
      if (initialLoads.has(router)) return;
      initialLoads.add(router);
      void loadAndSettleRouter(router).catch((error: unknown) => {
        initialLoads.delete(router);
        console.error("Error loading initial route", error);
      });
    }
  }, [router]);

  return null;
}

async function loadAndSettleRouter(
  router: AnyRouter,
  update?: HistoryUpdate,
): Promise<void> {
  await router.load(update);
  settleRouter(router);
}

function settleRouter(router: AnyRouter): void {
  const location = router.stores.location.get();
  const resolvedLocation = router.stores.resolvedLocation.get();
  const locationChanged = resolvedLocation?.href !== location.href;

  if (locationChanged) {
    router.emit({
      type: "onResolved",
      ...getLocationChangeInfo(location, resolvedLocation ?? location),
    });
  }
  batch(() => {
    if (router.stores.status.get() !== "idle") {
      router.stores.status.set("idle");
    }
    if (locationChanged) router.stores.resolvedLocation.set(location);
  });
}

export function Matches(): FigNode {
  const router = useRouter<AnyRouter>();
  const firstMatchId = useReadableStore(router.stores.firstId);
  return firstMatchId === undefined
    ? null
    : createElement(Match, { matchId: firstMatchId });
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

  const PendingComponent =
    route.options.pendingComponent ?? router.options.defaultPendingComponent;
  const ErrorComponent =
    route.options.errorComponent ?? router.options.defaultErrorComponent;

  const content = createElement(
    Suspense,
    {
      fallback:
        PendingComponent === undefined ? null : createElement(PendingComponent),
    },
    createElement(MatchContent, { match, route }),
  );

  return createElement(
    MatchContext,
    { value: match.id },
    ErrorComponent
      ? createElement(
          ErrorBoundary,
          {
            key:
              match.status === "error"
                ? `route-error:${match.fetchCount}`
                : `route:${manualResetKey}`,
            fallback: (error) =>
              createElement(ErrorComponent, {
                error,
                reset: () => {
                  dataStoreFromContext(match.context)?.invalidateDataError(
                    error,
                  );
                  void router.invalidate().then(() => {
                    settleRouter(router);
                    if (match.status !== "error") {
                      setManualResetKey((key) => key + 1);
                    }
                  });
                },
              }),
          },
          content,
        )
      : content,
  );
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
    const PendingComponent =
      route.options.pendingComponent ?? router.options.defaultPendingComponent;
    return PendingComponent === undefined
      ? null
      : createElement(PendingComponent);
  }
  if (match.status === "error") throw match.error;
  if (match.status === "redirected") return null;
  if (match.status === "notFound") return renderNotFound(router, route, match);

  const Component = route.options.component ?? router.options.defaultComponent;
  return Component === undefined
    ? createElement(Outlet)
    : createElement(Component);
}

export function Outlet(): FigNode {
  const router = useRouter<AnyRouter>();
  const parentMatchId = readContext(MatchContext);
  const matchIds = useReadableStore(router.stores.matchesId);
  const parentIndex = matchIds.findIndex((id) => id === parentMatchId);
  const parentMatch =
    parentMatchId === null
      ? undefined
      : router.stores.matchStores.get(parentMatchId)?.get();
  if (parentMatch?.globalNotFound === true) {
    const route = router.routesById[parentMatch.routeId];
    if (route === undefined) {
      throw new Error(
        `Could not find route ${JSON.stringify(parentMatch.routeId)}.`,
      );
    }
    return renderNotFound(router, route, parentMatch);
  }
  const childMatchId = matchIds[parentIndex + 1];
  return childMatchId === undefined
    ? null
    : createElement(Match, { matchId: childMatchId });
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

function dataStoreFromContext(context: unknown): FigDataStoreHandle | null {
  if (typeof context !== "object" || context === null) return null;
  const data = (context as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return null;
  const candidate = data as Partial<FigDataStoreHandle>;
  return typeof candidate.ensureData === "function" &&
    typeof candidate.invalidateDataError === "function" &&
    typeof candidate.preloadData === "function"
    ? (candidate as FigDataStoreHandle)
    : null;
}

type AnchorProps = HostIntrinsicElements["a"];

export type LinkProps<
  TFrom extends string = string,
  TTo extends string | undefined = ".",
  TMaskFrom extends string = TFrom,
  TMaskTo extends string = ".",
> = AnchorProps & LinkOptions<RegisteredRouter, TFrom, TTo, TMaskFrom, TMaskTo>;

const preloadTimeouts = new WeakMap<
  EventTarget,
  ReturnType<typeof setTimeout>
>();

export function Link<
  const TFrom extends string = string,
  const TTo extends string | undefined = undefined,
  const TMaskFrom extends string = TFrom,
  const TMaskTo extends string = "",
>(props: LinkProps<TFrom, TTo, TMaskFrom, TMaskTo>): FigNode {
  const router = useRouter<RegisteredRouter>();
  const currentLocation = useReadableStore(router.stores.location);
  const {
    _fromLocation,
    activeOptions,
    children,
    disabled,
    from: _from,
    hash: _hash,
    hashScrollIntoView: _hashScrollIntoView,
    href: explicitHref,
    ignoreBlocker: _ignoreBlocker,
    mask: _mask,
    mix,
    params: _params,
    preload: requestedPreload,
    preloadDelay: requestedPreloadDelay,
    preloadIntentProximity: _preloadIntentProximity,
    reloadDocument,
    replace: _replace,
    resetScroll: _resetScroll,
    search: _search,
    startTransition: _startTransition,
    state: _state,
    target,
    to,
    unsafeRelative: _unsafeRelative,
    ...anchorProps
  } = props;
  const absolute = isAbsoluteLinkTarget(to, router.origin);
  const next = !absolute
    ? router.buildLocation<RegisteredRouter, TTo, TFrom, TMaskFrom, TMaskTo>({
        ...props,
        _isNavigate: false,
      })
    : undefined;
  const displayedLocation = next?.maskedLocation ?? next;
  const href = disabled
    ? undefined
    : (explicitHref ??
      (absolute ? to : undefined) ??
      (displayedLocation === undefined
        ? undefined
        : router.history.createHref(displayedLocation.publicHref) || "/"));
  const external =
    absolute ||
    displayedLocation?.external === true ||
    (explicitHref !== undefined &&
      isAbsoluteLinkTarget(explicitHref, router.origin));
  const dangerous =
    href !== undefined
      ? isDangerousProtocol(href, router.protocolAllowlist)
      : false;
  const preload =
    reloadDocument || external || dangerous || explicitHref !== undefined
      ? false
      : (requestedPreload ?? router.options.defaultPreload);
  const preloadDelay =
    requestedPreloadDelay ?? router.options.defaultPreloadDelay ?? 0;
  const isActive =
    next !== undefined &&
    !external &&
    linkPathIsActive(
      currentLocation.pathname,
      next.pathname,
      router.basepath,
      activeOptions?.exact ?? false,
    ) &&
    (!(activeOptions?.includeSearch ?? true) ||
      deepEqual(currentLocation.search, next.search, {
        ignoreUndefined: !activeOptions?.explicitUndefined,
        partial: !(activeOptions?.exact ?? false),
      })) &&
    (!activeOptions?.includeHash || currentLocation.hash === next.hash);

  const preloadRoute = useCallback(() => {
    void router
      .preloadRoute<TFrom, TTo, TMaskFrom, TMaskTo>(props)
      .catch((error: unknown) => {
        console.warn("Error preloading route", error);
      });
  }, [href, router]);

  useReactive(() => {
    if (!disabled && preload === "render") preloadRoute();
  }, [disabled, preload, preloadRoute]);

  const viewportBind = useCallback(
    (element: HTMLAnchorElement, signal: AbortSignal): undefined => {
      if (disabled || preload !== "viewport") return undefined;
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          preloadRoute();
        }
      });
      observer.observe(element);
      signal.addEventListener("abort", () => observer.disconnect(), {
        once: true,
      });
      return undefined;
    },
    [disabled, preload, preloadRoute],
  );

  const beginIntentPreload = (event: Event) => {
    if (disabled || preload !== "intent") return;
    if (preloadDelay === 0) {
      preloadRoute();
      return;
    }
    const target = event.currentTarget;
    if (target === null) return;
    if (preloadTimeouts.has(target)) return;
    const timeout = setTimeout(() => {
      preloadTimeouts.delete(target);
      preloadRoute();
    }, preloadDelay);
    preloadTimeouts.set(target, timeout);
  };
  const cancelIntentPreload = (event: Event) => {
    const target = event.currentTarget;
    if (target === null) return;
    const timeout = preloadTimeouts.get(target);
    if (timeout === undefined) return;
    clearTimeout(timeout);
    preloadTimeouts.delete(target);
  };

  return createElement(
    "a",
    {
      ...anchorProps,
      "aria-current": isActive ? "page" : undefined,
      "aria-disabled": disabled ? true : undefined,
      "data-status": isActive ? "active" : undefined,
      bind:
        preload === "viewport"
          ? composeBind(anchorProps.bind, viewportBind)
          : anchorProps.bind,
      href: dangerous ? undefined : href,
      mix: [
        mix,
        on("click", (event) => {
          const elementTarget =
            event.currentTarget instanceof Element
              ? event.currentTarget.getAttribute("target")
              : null;
          const effectiveTarget = target ?? elementTarget;
          if (
            disabled ||
            dangerous ||
            external ||
            reloadDocument ||
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.altKey ||
            event.ctrlKey ||
            event.shiftKey ||
            (effectiveTarget !== null &&
              effectiveTarget !== "" &&
              effectiveTarget !== "_self") ||
            anchorProps.download !== undefined
          ) {
            return;
          }
          event.preventDefault();
          void router.navigate<
            RegisteredRouter,
            TTo,
            TFrom,
            TMaskFrom,
            TMaskTo
          >(props);
        }),
        preload === "intent" && on("mouseenter", beginIntentPreload),
        preload === "intent" && on("mouseleave", cancelIntentPreload),
        preload === "intent" && on("focus", beginIntentPreload),
        preload === "intent" && on("blur", cancelIntentPreload),
        preload === "intent" &&
          on("touchstart", () => {
            if (!disabled) preloadRoute();
          }),
      ],
      role: disabled ? "link" : anchorProps.role,
      target,
    },
    children,
  );
}

function selectStoreValue<TValue>(value: TValue): TValue {
  return value;
}

function useReadableStore<TValue>(store: RouterReadableStore<TValue>): TValue;
function useReadableStore<TValue, TSelected>(
  store: RouterReadableStore<TValue>,
  select: (value: TValue) => TSelected,
): TSelected;
function useReadableStore<TValue, TSelected = TValue>(
  store: RouterReadableStore<TValue>,
  select: (value: TValue) => TSelected = selectStoreValue as (
    value: TValue,
  ) => TSelected,
): TSelected {
  if (typeof Reflect.get(store, "subscribe") !== "function") {
    return select(store.get());
  }
  const subscribe = useCallback(
    (onChange: () => void) => {
      const subscription = store.subscribe(onChange);
      return subscription.unsubscribe;
    },
    [store],
  );
  const getSnapshot = useMemo(() => {
    let source: TValue | undefined;
    let selected: TSelected;
    let initialized = false;
    return () => {
      const nextSource = store.get();
      if (initialized && Object.is(source, nextSource)) return selected;
      source = nextSource;
      selected = select(nextSource);
      initialized = true;
      return selected;
    };
  }, [select, store]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function linkPathIsActive(
  currentPathname: string,
  nextPathname: string,
  basepath: string,
  exact: boolean,
): boolean {
  if (exact) return exactPathTest(currentPathname, nextPathname, basepath);
  const current = removeTrailingSlash(currentPathname, basepath);
  const next = removeTrailingSlash(nextPathname, basepath);
  return (
    current.startsWith(next) &&
    (current.length === next.length || current[next.length] === "/")
  );
}

function isAbsoluteLinkTarget(
  value: unknown,
  origin: string | undefined,
): value is string {
  if (typeof value !== "string") return false;
  if (!value.startsWith("//") && !value.includes(":")) return false;
  try {
    new URL(value, origin);
    return true;
  } catch {
    return false;
  }
}
