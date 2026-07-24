import {
  createContext,
  type FigNode,
  readContext,
  useBeforePaint,
  useCallback,
  useMemo,
  useState,
} from "@bgub/fig";
import type {
  BlockerFnArgs,
  HistoryAction,
  HistoryLocation,
} from "@tanstack/history";
import {
  type AnyRoute,
  type AnyRouteMatch,
  type AnyRouter,
  type DeepPartial,
  deepEqual,
  type Expand,
  type FromPathOption,
  type MakeOptionalPathParams,
  type MakeOptionalSearchParams,
  type MakeRouteMatch,
  type MakeRouteMatchUnion,
  type MaskOptions,
  type MatchRouteOptions,
  type NavigateOptions,
  type ParseRoute,
  replaceEqualDeep,
  type RegisteredRouter,
  type ResolveRoute,
  type ResolveUseLoaderDeps,
  type ResolveUseParams,
  type ResolveUseSearch,
  type RouteIds,
  type RouterReadableStore,
  type RouterState,
  type StrictOrFrom,
  type ThrowConstraint,
  type ThrowOrOptional,
  type ToSubOptionsProps,
  type UseLoaderDepsResult,
  type UseNavigateResult,
  type UseParamsResult,
  type UseRouteContextResult,
  type UseSearchResult,
} from "@tanstack/router-core";
import { useReadableStore } from "./store.ts";

export type StructuralSharingOptions = {
  structuralSharing?: boolean;
};

export type SelectRouteValue<TValue, TSelected> = StructuralSharingOptions & {
  select?: (value: TValue) => TSelected;
};

export type RouteMatchResult<
  TRouter extends AnyRouter,
  TFrom,
  TStrict extends boolean,
  TSelected,
> = unknown extends TSelected
  ? TStrict extends true
    ? MakeRouteMatch<TRouter["routeTree"], TFrom, true>
    : MakeRouteMatchUnion<TRouter>
  : TSelected;

export const RouterContext = createContext<AnyRouter | null>(null);
export const MatchContext =
  createContext<RouterReadableStore<AnyRouteMatch> | null>(null);
const missingMatch = Symbol("missing route match");
const missingMatchStore = {
  get: () => undefined,
};
export function useRouter<
  TRouter extends AnyRouter = RegisteredRouter,
>(): TRouter {
  return requireRouter(readContext(RouterContext)) as TRouter;
}

function requireRouter(router: AnyRouter | null): AnyRouter {
  if (router === null) {
    throw new Error("Router hooks must be used inside <RouterProvider>.");
  }
  return router;
}

function useStoreSelector<TValue, TSelected = TValue>(
  router: AnyRouter,
  options?: SelectRouteValue<TValue, TSelected>,
): (value: TValue) => TSelected {
  const previous = useMemo<{ initialized: boolean; value: TSelected }>(
    () => ({ initialized: false, value: undefined as TSelected }),
    [],
  );
  const select = options?.select;
  const structuralSharing =
    options?.structuralSharing ??
    router.options.defaultStructuralSharing ??
    false;
  return useCallback(
    (value: TValue) => {
      let selected = (
        select === undefined ? value : select(value)
      ) as TSelected;
      if (structuralSharing && previous.initialized) {
        selected = replaceEqualDeep(previous.value, selected);
      }
      previous.initialized = true;
      previous.value = selected;
      return selected;
    },
    [previous, select, structuralSharing],
  );
}

export function useRouterState<
  TRouter extends AnyRouter = RegisteredRouter,
  TSelected = RouterState<TRouter["routeTree"]>,
>(
  options?: SelectRouteValue<RouterState<TRouter["routeTree"]>, TSelected> & {
    router?: TRouter;
  },
): TSelected {
  const router = requireRouter(options?.router ?? readContext(RouterContext));
  const select = useStoreSelector(router, options);
  return useReadableStore(router.stores.__store, select) as TSelected;
}

export function useLocation<
  TRouter extends AnyRouter = RegisteredRouter,
  TLocation = RouterState<TRouter["routeTree"]>["location"],
>(
  options?: SelectRouteValue<
    RouterState<TRouter["routeTree"]>["location"],
    TLocation
  >,
): TLocation {
  const router = useRouter<TRouter>();
  const select = useStoreSelector(router, options);
  return useReadableStore(router.stores.location, select) as TLocation;
}

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

export type ShouldBlockFn<TRouter extends AnyRouter = RegisteredRouter> =
  (args: {
    action: HistoryAction;
    current: BlockerLocationUnion<TRouter>;
    next: BlockerLocationUnion<TRouter>;
  }) => boolean | Promise<boolean>;

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

  useBeforePaint(
    (signal) => {
      if (disabled) return undefined;
      let settlePending: ((shouldBlock: boolean) => void) | undefined;
      const unblock = router.history.block({
        enableBeforeUnload,
        blockerFn: async (args: BlockerFnArgs) => {
          const current = blockerLocation(router, args.currentLocation);
          const next = blockerLocation(router, args.nextLocation);
          const shouldBlock = await shouldBlockFn({
            action: args.action,
            current,
            next,
          });
          if (!withResolver || !shouldBlock) return shouldBlock;

          const resolved = await new Promise<boolean>((resolve) => {
            settlePending = resolve;
            setResolver({
              action: args.action,
              current,
              next,
              proceed: () => resolve(false),
              reset: () => resolve(true),
              status: "blocked",
            });
          });
          settlePending = undefined;
          setResolver(idleBlockerResolver);
          return resolved;
        },
      });
      signal.addEventListener(
        "abort",
        () => {
          unblock();
          settlePending?.(false);
        },
        { once: true },
      );
      return undefined;
    },
    [disabled, enableBeforeUnload, router, shouldBlockFn, withResolver],
  );

  return (withResolver ? resolver : undefined) as TWithResolver extends true
    ? BlockerResolver<TRouter>
    : void;
}

export function useCanGoBack(): boolean {
  const router = useRouter<AnyRouter>();
  return useReadableStore(router.stores.location, router.history.canGoBack);
}

function blockerLocation<TRouter extends AnyRouter>(
  router: TRouter,
  location: HistoryLocation,
): BlockerLocationUnion<TRouter> {
  const parsed = router.parseLocation(location);
  const matched = router.getMatchedRoutes(parsed.pathname);
  return {
    fullPath: matched.foundRoute?.fullPath ?? parsed.pathname,
    params: matched.routeParams,
    pathname: parsed.pathname,
    routeId: matched.foundRoute?.id ?? "__notFound__",
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

type TypedMatchOptions<
  TRouter extends AnyRouter,
  TFrom,
  TStrict extends boolean,
  TThrow extends boolean,
  TSelected,
> = StrictOrFrom<TRouter, TFrom, TStrict> &
  SelectRouteValue<
    MakeRouteMatch<TRouter["routeTree"], TFrom, TStrict>,
    TSelected
  > & {
    shouldThrow?: TThrow;
  };

export function useMatch<
  TRouter extends AnyRouter = RegisteredRouter,
  const TFrom extends string | undefined = undefined,
  TStrict extends boolean = true,
  TThrow extends boolean = true,
  TSelected = unknown,
>(
  options?: TypedMatchOptions<
    TRouter,
    TFrom,
    TStrict,
    ThrowConstraint<TStrict, TThrow>,
    TSelected
  >,
): ThrowOrOptional<
  RouteMatchResult<TRouter, TFrom, TStrict, TSelected>,
  TThrow
> {
  return useMatchValue(
    options?.from,
    options,
    (match) => match as MakeRouteMatch<TRouter["routeTree"], TFrom, TStrict>,
    options?.shouldThrow,
  ) as ThrowOrOptional<
    RouteMatchResult<TRouter, TFrom, TStrict, TSelected>,
    TThrow
  >;
}

function useMatchSelection(
  from: string | undefined,
  select: ((match: AnyRouteMatch) => unknown) | undefined,
  shouldThrow = true,
  structuralSharing?: boolean,
): unknown {
  const router = useRouter<AnyRouter>();
  const nearestMatchStore = readContext(MatchContext);
  const store =
    from === undefined || nearestMatchStore?.get().routeId === from
      ? nearestMatchStore
      : router.stores.getRouteMatchStore(from);
  const selectMatch = useStoreSelector(router, { select, structuralSharing });

  const selectPresentMatch = useCallback(
    (match: AnyRouteMatch | undefined) =>
      match === undefined ? missingMatch : selectMatch(match),
    [selectMatch],
  );
  const selected = useReadableStore(
    store ?? missingMatchStore,
    selectPresentMatch,
  );
  if (selected === missingMatch) {
    if (shouldThrow) {
      const target = from
        ? `route ${JSON.stringify(from)}`
        : "the nearest route";
      throw new Error(`Could not find an active match for ${target}.`);
    }
    return undefined;
  }
  return selected;
}

export function useMatchValue<TValue>(
  from: string | undefined,
  options: SelectRouteValue<TValue, unknown> | undefined,
  getValue: (match: AnyRouteMatch) => TValue,
  shouldThrow = true,
): unknown {
  return useMatchSelection(
    from,
    (match) => {
      const value = getValue(match);
      return options?.select === undefined ? value : options.select(value);
    },
    shouldThrow,
    options?.structuralSharing,
  );
}

type TypedRouteValueOptions<
  TRouter extends AnyRouter,
  TFrom,
  TStrict extends boolean,
  TValue,
  TSelected,
> = StrictOrFrom<TRouter, TFrom, TStrict> & SelectRouteValue<TValue, TSelected>;

export function useParams<
  TRouter extends AnyRouter = RegisteredRouter,
  const TFrom extends string | undefined = undefined,
  TStrict extends boolean = true,
  TThrow extends boolean = true,
  TSelected = unknown,
>(
  options?: TypedRouteValueOptions<
    TRouter,
    TFrom,
    TStrict,
    ResolveUseParams<TRouter, TFrom, TStrict>,
    TSelected
  > & { shouldThrow?: ThrowConstraint<TStrict, TThrow> },
): ThrowOrOptional<
  UseParamsResult<TRouter, TFrom, TStrict, TSelected>,
  TThrow
> {
  return useMatchValue(
    options?.from,
    options,
    (match) => match.params as ResolveUseParams<TRouter, TFrom, TStrict>,
    options?.shouldThrow,
  ) as ThrowOrOptional<
    UseParamsResult<TRouter, TFrom, TStrict, TSelected>,
    TThrow
  >;
}

export function useSearch<
  TRouter extends AnyRouter = RegisteredRouter,
  const TFrom extends string | undefined = undefined,
  TStrict extends boolean = true,
  TThrow extends boolean = true,
  TSelected = unknown,
>(
  options?: TypedRouteValueOptions<
    TRouter,
    TFrom,
    TStrict,
    ResolveUseSearch<TRouter, TFrom, TStrict>,
    TSelected
  > & { shouldThrow?: ThrowConstraint<TStrict, TThrow> },
): ThrowOrOptional<
  UseSearchResult<TRouter, TFrom, TStrict, TSelected>,
  TThrow
> {
  return useMatchValue(
    options?.from,
    options,
    (match) => match.search as ResolveUseSearch<TRouter, TFrom, TStrict>,
    options?.shouldThrow,
  ) as ThrowOrOptional<
    UseSearchResult<TRouter, TFrom, TStrict, TSelected>,
    TThrow
  >;
}

export function useLoaderDeps<
  TRouter extends AnyRouter = RegisteredRouter,
  const TFrom extends RouteIds<TRouter["routeTree"]> = RouteIds<
    TRouter["routeTree"]
  >,
  TSelected = unknown,
>(
  options?: SelectRouteValue<
    ResolveUseLoaderDeps<TRouter, TFrom>,
    TSelected
  > & { from: TFrom },
): UseLoaderDepsResult<TRouter, TFrom, TSelected> {
  return useMatchValue(
    options?.from,
    options,
    (match) => match.loaderDeps as ResolveUseLoaderDeps<TRouter, TFrom>,
  ) as UseLoaderDepsResult<TRouter, TFrom, TSelected>;
}

export function useRouteContext<
  TRouter extends AnyRouter = RegisteredRouter,
  const TFrom extends string | undefined = undefined,
  TStrict extends boolean = true,
  TSelected = unknown,
>(
  options?: TypedRouteValueOptions<
    TRouter,
    TFrom,
    TStrict,
    UseRouteContextResult<TRouter, TFrom, TStrict, unknown>,
    TSelected
  >,
): UseRouteContextResult<TRouter, TFrom, TStrict, TSelected> {
  return useMatchValue(
    options?.from,
    options,
    (match) =>
      match.context as UseRouteContextResult<TRouter, TFrom, TStrict, unknown>,
  ) as UseRouteContextResult<TRouter, TFrom, TStrict, TSelected>;
}

export function useNavigate<
  TRouter extends AnyRouter = RegisteredRouter,
  TDefaultFrom extends string = string,
>(options?: {
  from?: FromPathOption<TRouter, TDefaultFrom>;
}): UseNavigateResult<TDefaultFrom> {
  return useNavigateFrom(options?.from) as UseNavigateResult<TDefaultFrom>;
}

export function useNavigateFrom(
  from: string | undefined,
): UseNavigateResult<string> {
  const router = useRouter<AnyRouter>();
  return useCallback(
    ((navigateOptions: NavigateOptions) =>
      router.navigate({
        ...navigateOptions,
        from: navigateOptions.from ?? from,
      } as never)) as UseNavigateResult<string>,
    [from, router],
  );
}

export function Navigate<
  TRouter extends AnyRouter = RegisteredRouter,
  const TFrom extends string = string,
  const TTo extends string | undefined = undefined,
  const TMaskFrom extends string = TFrom,
  const TMaskTo extends string = "",
>(props: NavigateOptions<TRouter, TFrom, TTo, TMaskFrom, TMaskTo>): null {
  const navigate = useNavigateFrom(undefined);
  const previous = useMemo<{ props: typeof props | undefined }>(
    () => ({ props: undefined }),
    [],
  );
  useBeforePaint(() => {
    if (previous.props === undefined || !deepEqual(previous.props, props)) {
      previous.props = props;
      void navigate(props as never);
    }
    return undefined;
  }, [navigate, previous, props]);
  return null;
}

export type UseMatchesOptions<
  TRouter extends AnyRouter,
  TSelected,
> = StructuralSharingOptions & {
  select?: (matches: Array<MakeRouteMatchUnion<TRouter>>) => TSelected;
};

export type UseMatchesResult<
  TRouter extends AnyRouter,
  TSelected,
> = unknown extends TSelected ? Array<MakeRouteMatchUnion<TRouter>> : TSelected;

export function useMatches<
  TRouter extends AnyRouter = RegisteredRouter,
  TSelected = unknown,
>(
  options?: UseMatchesOptions<TRouter, TSelected>,
): UseMatchesResult<TRouter, TSelected> {
  const router = useRouter<TRouter>();
  const select = useStoreSelector(router, options);
  return useReadableStore(
    router.stores.matches,
    select as (matches: AnyRouteMatch[]) => TSelected,
  ) as UseMatchesResult<TRouter, TSelected>;
}

export type UseMatchRouteOptions<
  TRouter extends AnyRouter = RegisteredRouter,
  TFrom extends string = string,
  TTo extends string | undefined = undefined,
  TMaskFrom extends string = TFrom,
  TMaskTo extends string = "",
> = ToSubOptionsProps<TRouter, TFrom, TTo> &
  DeepPartial<MakeOptionalSearchParams<TRouter, TFrom, TTo>> &
  DeepPartial<MakeOptionalPathParams<TRouter, TFrom, TTo>> &
  MaskOptions<TRouter, TMaskFrom, TMaskTo> &
  MatchRouteOptions;

export type MatchRouteFn<TRouter extends AnyRouter = RegisteredRouter> = <
  const TFrom extends string = string,
  const TTo extends string | undefined = undefined,
  const TMaskFrom extends string = TFrom,
  const TMaskTo extends string = "",
>(
  options: UseMatchRouteOptions<TRouter, TFrom, TTo, TMaskFrom, TMaskTo>,
) => false | Expand<ResolveRoute<TRouter, TFrom, TTo>["types"]["allParams"]>;

export function useMatchRoute<
  TRouter extends AnyRouter = RegisteredRouter,
>(): MatchRouteFn<TRouter> {
  const router = useRouter<TRouter>();
  useReadableStore(router.stores.matchRouteDeps);
  return useCallback(
    (options: UseMatchRouteOptions<TRouter>) => {
      const { pending, caseSensitive, fuzzy, includeSearch, ...location } =
        options;
      return router.matchRoute(location as never, {
        pending,
        caseSensitive,
        fuzzy,
        includeSearch,
      });
    },
    [router],
  ) as MatchRouteFn<TRouter>;
}

export type MakeMatchRouteOptions<
  TRouter extends AnyRouter = RegisteredRouter,
  TFrom extends string = string,
  TTo extends string | undefined = undefined,
  TMaskFrom extends string = TFrom,
  TMaskTo extends string = "",
> = UseMatchRouteOptions<TRouter, TFrom, TTo, TMaskFrom, TMaskTo> & {
  children?:
    | FigNode
    | ((
        params?: Expand<
          ResolveRoute<TRouter, TFrom, TTo>["types"]["allParams"]
        >,
      ) => FigNode);
};

export function MatchRoute<
  TRouter extends AnyRouter = RegisteredRouter,
  const TFrom extends string = string,
  const TTo extends string | undefined = undefined,
  const TMaskFrom extends string = TFrom,
  const TMaskTo extends string = "",
>(
  props: MakeMatchRouteOptions<TRouter, TFrom, TTo, TMaskFrom, TMaskTo>,
): FigNode {
  const { children, ...options } = props;
  const params = useMatchRoute<TRouter>()(options as never);
  if (typeof children === "function") {
    return children(params === false ? undefined : params);
  }
  return params === false ? null : children;
}
