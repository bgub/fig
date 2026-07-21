import {
  assets,
  createContext,
  createElement,
  type ComponentType,
  type DataResource,
  ErrorBoundary,
  type ErrorInfo,
  type FigDataStoreHandle,
  type FigNode,
  type Props,
  readContext,
  readPromise,
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
  type BlockerFnArgs,
  type HistoryAction,
  type HistoryLocation,
  type RouterHistory,
} from "@tanstack/history";
import {
  type AnyContext,
  type AnyRoute,
  type AnyRouteMatch,
  type AnyRouter,
  appendUniqueUserTags,
  type AssetCrossOriginConfig,
  BaseRootRoute,
  BaseRoute,
  BaseRouteApi,
  type Constrain,
  createControlledPromise,
  type ConstrainLiteral,
  type CreateFileRoute,
  type CreateLazyFileRoute,
  type DeepPartial,
  deepEqual,
  escapeHtml,
  exactPathTest,
  type Expand,
  type FileRoutesByPath as CoreFileRoutesByPath,
  type FromPathOption,
  getLocationChangeInfo,
  type InferFrom,
  type InferMaskFrom,
  type InferMaskTo,
  type InferTo,
  isDangerousProtocol,
  isNotFound,
  type LinkOptions,
  type MakeOptionalPathParams,
  type MakeOptionalSearchParams,
  type MakeRouteMatch,
  type MakeRouteMatchUnion,
  type MaskOptions,
  type MatchRouteOptions,
  type MetaDescriptor,
  type NavigateOptions,
  notFound as createNotFound,
  type NotFoundError,
  type NotFoundRouteProps,
  type ParseRoute,
  removeTrailingSlash,
  type RegisteredRouter,
  type Register,
  replaceEqualDeep,
  type ResolveFullPath,
  type ResolveId,
  type ResolveUseLoaderData,
  type ResolveUseLoaderDeps,
  type ResolveUseParams,
  type ResolveUseSearch,
  type ResolveRoute,
  type ResolveParams,
  type RootRouteId,
  type RootRouteOptions,
  type RouteMask,
  rootRouteId,
  RouterCore,
  type RouterConstructorOptions,
  type RouterReadableStore,
  type RouterManagedTag,
  type RouterState,
  type RouteConstraints,
  type RouteIds,
  type RouteOptions,
  type RouteTypesById,
  setupScrollRestoration,
  type StrictOrFrom,
  type ThrowConstraint,
  type ThrowOrOptional,
  type ToMaskOptions,
  type ToSubOptionsProps,
  type TrailingSlashOption,
  type UseLoaderDataResult,
  type UseLoaderDepsResult,
  type UseNavigateResult,
  type UseParamsResult,
  type UseRouteContextResult,
  type UseSearchResult,
} from "@tanstack/router-core";
import { getScrollRestorationScriptForRouter } from "@tanstack/router-core/scroll-restoration-script";
import { batch } from "@tanstack/store";
import {
  collectRouteAssets,
  renderPositionedRouterTag,
  renderRouterHeadTags,
} from "./route-assets.ts";
import { getStoreConfig } from "./store.ts";

declare module "@tanstack/router-core" {
  interface RouteMatchExtensions {
    headScripts?: Array<HostIntrinsicElements["script"] | undefined>;
    links?: Array<HostIntrinsicElements["link"] | undefined>;
    meta?: Array<HostIntrinsicElements["meta"] | MetaDescriptor | undefined>;
    scripts?: Array<HostIntrinsicElements["script"] | undefined>;
    styles?: Array<HostIntrinsicElements["style"] | undefined>;
  }
}

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
  lazyFn,
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

type ValidateLinkOptions<
  TRouter extends AnyRouter,
  TOptions,
  TDefaultFrom extends string = string,
> = Constrain<
  TOptions,
  LinkOptions<
    TRouter,
    InferFrom<TOptions, TDefaultFrom>,
    InferTo<TOptions>,
    InferMaskFrom<TOptions>,
    InferMaskTo<TOptions>
  >
>;

type ValidateLinkOptionsArray<
  TRouter extends AnyRouter,
  TOptions extends ReadonlyArray<unknown>,
  TDefaultFrom extends string = string,
> = {
  [TIndex in keyof TOptions]: ValidateLinkOptions<
    TRouter,
    TOptions[TIndex],
    TDefaultFrom
  >;
};

export type LinkOptionsFnOptions<
  TOptions,
  TRouter extends AnyRouter = RegisteredRouter,
> =
  TOptions extends ReadonlyArray<unknown>
    ? ValidateLinkOptionsArray<TRouter, TOptions>
    : ValidateLinkOptions<TRouter, TOptions>;

export function linkOptions<
  const TOptions,
  TRouter extends AnyRouter = RegisteredRouter,
>(options: LinkOptionsFnOptions<TOptions, TRouter>): TOptions {
  return options as TOptions;
}

export interface FileRoutesByPath extends CoreFileRoutesByPath {}

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

interface StructuralSharingOptions {
  structuralSharing?: boolean;
}

interface SelectRouteValue<TValue, TSelected> extends StructuralSharingOptions {
  select?: (value: TValue) => TSelected;
}

type RouteMatchResult<
  TRouter extends AnyRouter,
  TFrom,
  TStrict extends boolean,
  TSelected,
> = unknown extends TSelected
  ? TStrict extends true
    ? MakeRouteMatch<TRouter["routeTree"], TFrom, true>
    : MakeRouteMatchUnion<TRouter>
  : TSelected;

export type UseMatchRoute<out TFrom> = <
  TRouter extends AnyRouter = RegisteredRouter,
  TSelected = unknown,
>(
  options?: SelectRouteValue<
    MakeRouteMatch<TRouter["routeTree"], TFrom, true>,
    TSelected
  >,
) => RouteMatchResult<TRouter, TFrom, true, TSelected>;

export type UseParamsRoute<out TFrom> = <
  TRouter extends AnyRouter = RegisteredRouter,
  TSelected = unknown,
>(
  options?: SelectRouteValue<ResolveUseParams<TRouter, TFrom, true>, TSelected>,
) => UseParamsResult<TRouter, TFrom, true, TSelected>;

export type UseSearchRoute<out TFrom> = <
  TRouter extends AnyRouter = RegisteredRouter,
  TSelected = unknown,
>(
  options?: SelectRouteValue<ResolveUseSearch<TRouter, TFrom, true>, TSelected>,
) => UseSearchResult<TRouter, TFrom, true, TSelected>;

export type UseLoaderDataRoute<out TFrom> = <
  TRouter extends AnyRouter = RegisteredRouter,
  TSelected = unknown,
>(
  options?: SelectRouteValue<
    ResolveUseLoaderData<TRouter, TFrom, true>,
    TSelected
  >,
) => UseLoaderDataResult<TRouter, TFrom, true, TSelected>;

export type UseLoaderDepsRoute<out TFrom> = <
  TRouter extends AnyRouter = RegisteredRouter,
  TSelected = unknown,
>(
  options?: SelectRouteValue<ResolveUseLoaderDeps<TRouter, TFrom>, TSelected>,
) => UseLoaderDepsResult<TRouter, TFrom, TSelected>;

export type UseRouteContextRoute<out TFrom> = <
  TRouter extends AnyRouter = RegisteredRouter,
  TSelected = unknown,
>(
  options?: SelectRouteValue<
    UseRouteContextResult<TRouter, TFrom, true, unknown>,
    TSelected
  >,
) => UseRouteContextResult<TRouter, TFrom, true, TSelected>;

export type LinkComponentRoute<TFrom extends string> = <
  const TTo extends string | undefined = undefined,
  const TMaskFrom extends string = TFrom,
  const TMaskTo extends string = "",
>(
  props: Omit<LinkProps<TFrom, TTo, TMaskFrom, TMaskTo>, "from">,
) => FigNode;

export interface RouteApiMethods<TId extends string, TFullPath extends string> {
  Link: LinkComponentRoute<TFullPath>;
  notFound: (options?: NotFoundError) => NotFoundError;
  useLoaderData: UseLoaderDataRoute<TId>;
  useLoaderDeps: UseLoaderDepsRoute<TId>;
  useMatch: UseMatchRoute<TId>;
  useNavigate: () => UseNavigateResult<TFullPath>;
  useParams: UseParamsRoute<TId>;
  useRouteContext: UseRouteContextRoute<TId>;
  useSearch: UseSearchRoute<TId>;
}

function bindRouteApi<TId extends string, TFullPath extends string>(
  getId: () => TId,
  useFullPath: () => TFullPath,
): RouteApiMethods<TId, TFullPath> {
  return {
    Link: (props) =>
      createElement(Link, {
        ...props,
        from: useFullPath(),
      } as never),
    notFound: (options) =>
      createNotFound({ routeId: getId(), ...options } as never),
    useLoaderData: (options) =>
      useMatchSelection(
        getId(),
        (match) =>
          options?.select === undefined
            ? match.loaderData
            : options.select(match.loaderData as never),
        true,
        options?.structuralSharing,
      ) as never,
    useLoaderDeps: (options) =>
      useMatchSelection(
        getId(),
        (match) =>
          options?.select === undefined
            ? match.loaderDeps
            : options.select(match.loaderDeps as never),
        true,
        options?.structuralSharing,
      ) as never,
    useMatch: (options) =>
      useMatchSelection(
        getId(),
        (match) =>
          options?.select === undefined
            ? match
            : options.select(match as never),
        true,
        options?.structuralSharing,
      ) as never,
    useNavigate: () => useNavigateFrom(useFullPath()) as never,
    useParams: (options) =>
      useMatchSelection(
        getId(),
        (match) =>
          options?.select === undefined
            ? match.params
            : options.select(match.params as never),
        true,
        options?.structuralSharing,
      ) as never,
    useRouteContext: (options) =>
      useMatchSelection(
        getId(),
        (match) =>
          options?.select === undefined
            ? match.context
            : options.select(match.context as never),
        true,
        options?.structuralSharing,
      ) as never,
    useSearch: (options) =>
      useMatchSelection(
        getId(),
        (match) =>
          options?.select === undefined
            ? match.search
            : options.select(match.search as never),
        true,
        options?.structuralSharing,
      ) as never,
  };
}

type RouteWithApi<
  TRoute,
  TId extends string,
  TFullPath extends string,
> = TRoute & RouteApiMethods<TId, TFullPath>;

function attachRouteApi<
  TId extends string,
  TFullPath extends string,
  TRoute extends { readonly fullPath: TFullPath; readonly id: TId },
>(route: TRoute): RouteWithApi<TRoute, TId, TFullPath> {
  return Object.assign(
    route,
    bindRouteApi(
      () => route.id,
      () => route.fullPath,
    ),
  );
}

declare module "@tanstack/router-core" {
  interface RouteExtensions<
    in out TId extends string,
    in out TFullPath extends string,
  > {
    Link: LinkComponentRoute<TFullPath>;
    notFound: (options?: NotFoundError) => NotFoundError;
    useLoaderData: UseLoaderDataRoute<TId>;
    useLoaderDeps: UseLoaderDepsRoute<TId>;
    useMatch: UseMatchRoute<TId>;
    useNavigate: () => UseNavigateResult<TFullPath>;
    useParams: UseParamsRoute<TId>;
    useRouteContext: UseRouteContextRoute<TId>;
    useSearch: UseSearchRoute<TId>;
  }

  interface UpdatableRouteOptionsExtensions {
    component?: RouteComponent;
    errorComponent?: false | null | ErrorRouteComponent;
    notFoundComponent?: NotFoundRouteComponent;
    pendingComponent?: RouteComponent;
  }

  interface RouterOptionsExtensions {
    assetCrossOrigin?: AssetCrossOriginConfig;
    defaultComponent?: RouteComponent;
    defaultErrorComponent?: ErrorRouteComponent;
    defaultNotFoundComponent?: NotFoundRouteComponent;
    defaultOnCatch?: (error: Error, info: ErrorInfo) => void;
    defaultPendingComponent?: RouteComponent;
  }
}

class Router<
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

export function createRouteMask<
  TRouteTree extends AnyRoute,
  TFrom extends string,
  TTo extends string,
>(
  options: { routeTree: TRouteTree } & ToMaskOptions<
    RouterCore<TRouteTree, "never", boolean>,
    TFrom,
    TTo
  >,
): RouteMask<TRouteTree> {
  return options as RouteMask<TRouteTree>;
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

export function getRouteApi<
  const TId extends string,
  TRouter extends AnyRouter = RegisteredRouter,
>(id: ConstrainLiteral<TId, RouteIds<TRouter["routeTree"]>>) {
  return new RouteApi<TId, TRouter>({ id });
}

class RouteApi<
  TId extends string,
  TRouter extends AnyRouter = RegisteredRouter,
> extends BaseRouteApi<TId, TRouter> {
  declare Link: LinkComponentRoute<RouteTypesById<TRouter, TId>["fullPath"]>;
  declare useLoaderData: UseLoaderDataRoute<TId>;
  declare useLoaderDeps: UseLoaderDepsRoute<TId>;
  declare useMatch: UseMatchRoute<TId>;
  declare useNavigate: () => UseNavigateResult<
    RouteTypesById<TRouter, TId>["fullPath"]
  >;
  declare useParams: UseParamsRoute<TId>;
  declare useRouteContext: UseRouteContextRoute<TId>;
  declare useSearch: UseSearchRoute<TId>;

  constructor({ id }: { id: TId }) {
    super({ id });
    Object.assign(
      this,
      bindRouteApi(
        () => String(this.id),
        () => {
          const router = useRouter<TRouter>();
          return router.routesById[String(this.id)].fullPath;
        },
      ),
    );
  }
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
  THandlers = undefined,
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
    TServerMiddlewares,
    THandlers
  >,
): RouteWithApi<
  BaseRoute<
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
    TServerMiddlewares,
    THandlers
  >,
  TId,
  TFullPath
> {
  return attachRouteApi(new BaseRoute(options));
}

export function createFileRoute<
  TFilePath extends keyof FileRoutesByPath,
  TParentRoute extends AnyRoute = FileRoutesByPath[TFilePath]["parentRoute"],
  TId extends RouteConstraints["TId"] = FileRoutesByPath[TFilePath]["id"],
  TPath extends RouteConstraints["TPath"] = FileRoutesByPath[TFilePath]["path"],
  TFullPath extends RouteConstraints["TFullPath"] =
    FileRoutesByPath[TFilePath]["fullPath"],
>(
  _path?: TFilePath,
): CreateFileRoute<TFilePath, TParentRoute, TId, TPath, TFullPath> {
  return ((options) => {
    const route = attachRouteApi(new BaseRoute(options as any));
    Reflect.set(route, "isRoot", false);
    return route as any;
  }) as CreateFileRoute<TFilePath, TParentRoute, TId, TPath, TFullPath>;
}

export function createLazyFileRoute<
  TFilePath extends keyof FileRoutesByPath,
  TRoute extends FileRoutesByPath[TFilePath]["preLoaderRoute"],
>(id: TFilePath): CreateLazyFileRoute<TRoute> {
  return (options) => ({ options: { id, ...options } });
}

export type AsyncRouteComponent<TProps = Props> = ComponentType<TProps> & {
  preload?: () => Promise<void>;
};

type ImportedRouteComponent<TValue> =
  TValue extends ComponentType<infer TProps>
    ? AsyncRouteComponent<TProps>
    : never;

export function lazyRouteComponent<TComponent>(
  importer: () => Promise<{ default: TComponent }>,
): ImportedRouteComponent<TComponent>;
export function lazyRouteComponent<
  TModule extends Record<string, unknown>,
  TKey extends keyof TModule,
>(
  importer: () => Promise<TModule>,
  exportName: TKey,
): ImportedRouteComponent<TModule[TKey]>;
export function lazyRouteComponent(
  importer: () => Promise<Record<string, unknown>>,
  exportName = "default",
): AsyncRouteComponent {
  let component: ComponentType | undefined;
  let loadPromise: Promise<ComponentType> | undefined;

  const load = () =>
    (loadPromise ??= importer().then((module) => {
      const imported = Reflect.get(module, exportName);
      if (!isRouteComponent(imported)) {
        throw new TypeError(
          `Route module export ${JSON.stringify(exportName)} is not a component.`,
        );
      }
      component = imported;
      return imported;
    }));

  const LazyComponent: ComponentType = (props) =>
    createElement(component ?? readPromise(load()), props);

  return Object.assign(LazyComponent, {
    preload: async () => {
      await load();
    },
  });
}

function isRouteComponent(value: unknown): value is ComponentType {
  return typeof value === "function";
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
): RouteWithApi<
  BaseRootRoute<
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
  >,
  RootRouteId,
  "/"
> {
  return attachRouteApi(new BaseRootRoute(options));
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
  ) => createRootRoute(options);
}

const RouterContext = createContext<AnyRouter | null>(null);
const MatchContext = createContext<string | null>(null);
const missingMatch = Symbol("missing route match");
const missingMatchStore: RouterReadableStore<AnyRouteMatch | undefined> = {
  get: () => undefined,
  subscribe: () => ({ unsubscribe: () => undefined }),
};
type HistoryUpdate = Parameters<Parameters<RouterHistory["subscribe"]>[0]>[0];

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

interface StoreSelectionOptions<
  TValue,
  TSelected,
> extends StructuralSharingOptions {
  select?: (value: TValue) => TSelected;
}

function useStoreSelector<TValue, TSelected = TValue>(
  router: AnyRouter,
  options?: StoreSelectionOptions<TValue, TSelected>,
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

interface UseRouterStateOptions<
  TRouter extends AnyRouter,
  TSelected,
> extends StructuralSharingOptions {
  router?: TRouter;
  select?: (state: RouterState<TRouter["routeTree"]>) => TSelected;
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
  const select = useStoreSelector(router, options);
  return useReadableStore(router.stores.__store, select);
}

export function useLocation<
  TRouter extends AnyRouter = RegisteredRouter,
  TSelected = unknown,
>(
  options?: StoreSelectionOptions<
    RouterState<TRouter["routeTree"]>["location"],
    TSelected
  >,
): unknown extends TSelected
  ? RouterState<TRouter["routeTree"]>["location"]
  : TSelected {
  const router = useRouter<TRouter>();
  const select = useStoreSelector(router, options);
  return useReadableStore(router.stores.location, select) as never;
}

interface BlockerLocation<
  out TRouteId = string,
  out TFullPath = string,
  out TParams = unknown,
  out TSearch = unknown,
> {
  fullPath: TFullPath;
  params: TParams;
  pathname: string;
  routeId: TRouteId;
  search: TSearch;
}

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

interface ShouldBlockArgs<TRouter extends AnyRouter = RegisteredRouter> {
  action: HistoryAction;
  current: BlockerLocationUnion<TRouter>;
  next: BlockerLocationUnion<TRouter>;
}

export type ShouldBlockFn<TRouter extends AnyRouter = RegisteredRouter> = (
  args: ShouldBlockArgs<TRouter>,
) => boolean | Promise<boolean>;

export interface UseBlockerOpts<
  TRouter extends AnyRouter = RegisteredRouter,
  TWithResolver extends boolean = boolean,
> {
  disabled?: boolean;
  enableBeforeUnload?: boolean | (() => boolean);
  shouldBlockFn: ShouldBlockFn<TRouter>;
  withResolver?: TWithResolver;
}

export function useBlocker<
  TRouter extends AnyRouter = RegisteredRouter,
  TWithResolver extends boolean = false,
>(
  options: UseBlockerOpts<TRouter, TWithResolver>,
): TWithResolver extends true ? BlockerResolver<TRouter> : void;
export function useBlocker(
  options: UseBlockerOpts<AnyRouter>,
): BlockerResolver<AnyRouter> | void {
  const {
    disabled = false,
    enableBeforeUnload = true,
    shouldBlockFn,
    withResolver = false,
  } = options;
  const router = useRouter<AnyRouter>();
  const [resolver, setResolver] =
    useState<BlockerResolver<AnyRouter>>(idleBlockerResolver);

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

  return withResolver ? resolver : undefined;
}

export function useCanGoBack(): boolean {
  const router = useRouter<AnyRouter>();
  return useReadableStore(router.stores.location, router.history.canGoBack);
}

function blockerLocation(
  router: AnyRouter,
  location: HistoryLocation,
): BlockerLocation<string, string> {
  const parsed = router.parseLocation(location);
  const matched = router.getMatchedRoutes(parsed.pathname);
  return {
    fullPath: matched.foundRoute?.fullPath ?? parsed.pathname,
    params: matched.routeParams,
    pathname: parsed.pathname,
    routeId: matched.foundRoute?.id ?? "__notFound__",
    search: parsed.search,
  };
}

const idleBlockerResolver: BlockerResolver<AnyRouter> = {
  action: undefined,
  current: undefined,
  next: undefined,
  proceed: undefined,
  reset: undefined,
  status: "idle",
};

interface MatchOptions<TSelected> extends StructuralSharingOptions {
  from?: string;
  select?: (match: AnyRouteMatch) => TSelected;
  shouldThrow?: boolean;
  strict?: boolean;
}

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

interface FromRouteOptions<
  TFrom extends string,
  TValue,
  TSelected,
> extends SelectRouteValue<TValue, TSelected> {
  from: TFrom;
}

export function useMatch(): AnyRouteMatch;
export function useMatch<
  TRouter extends AnyRouter = RegisteredRouter,
  const TFrom extends string | undefined = undefined,
  TStrict extends boolean = true,
  TThrow extends boolean = true,
  TSelected = unknown,
>(
  options: TypedMatchOptions<
    TRouter,
    TFrom,
    TStrict,
    ThrowConstraint<TStrict, TThrow>,
    TSelected
  >,
): ThrowOrOptional<
  RouteMatchResult<TRouter, TFrom, TStrict, TSelected>,
  TThrow
>;
export function useMatch(options?: MatchOptions<AnyRouteMatch>): AnyRouteMatch;
export function useMatch<TSelected>(
  options: MatchOptions<TSelected> & {
    select: (match: AnyRouteMatch) => TSelected;
  },
): TSelected;
export function useMatch(options?: MatchOptions<unknown>): unknown {
  return useMatchSelection(
    options?.from,
    options?.select,
    options?.shouldThrow,
    options?.structuralSharing,
  );
}

function useMatchSelection(
  from: string | undefined,
  select: ((match: AnyRouteMatch) => unknown) | undefined,
  shouldThrow = true,
  structuralSharing?: boolean,
): unknown {
  const router = useRouter<AnyRouter>();
  const nearestMatchId = readContext(MatchContext);
  const store = from
    ? router.stores.getRouteMatchStore(from)
    : nearestMatchId === null
      ? undefined
      : router.stores.matchStores.get(nearestMatchId);
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
    if (shouldThrow) throwMissingMatch(from);
    return undefined;
  }
  return selected;
}

function throwMissingMatch(from?: string): never {
  const target = from ? `route ${JSON.stringify(from)}` : "the nearest route";
  throw new Error(`Could not find an active match for ${target}.`);
}

type TypedRouteValueOptions<
  TRouter extends AnyRouter,
  TFrom,
  TStrict extends boolean,
  TValue,
  TSelected,
> = StrictOrFrom<TRouter, TFrom, TStrict> & SelectRouteValue<TValue, TSelected>;

interface RuntimeRouteValueOptions extends StructuralSharingOptions {
  from?: string;
  select?: (value: unknown) => unknown;
  shouldThrow?: boolean;
  strict?: boolean;
}

export function useParams(): AnyRouteMatch["params"];
export function useParams<
  TRouter extends AnyRouter = RegisteredRouter,
  const TFrom extends string | undefined = undefined,
  TStrict extends boolean = true,
  TThrow extends boolean = true,
  TSelected = unknown,
>(
  options: TypedRouteValueOptions<
    TRouter,
    TFrom,
    TStrict,
    ResolveUseParams<TRouter, TFrom, TStrict>,
    TSelected
  > & { shouldThrow?: ThrowConstraint<TStrict, TThrow> },
): ThrowOrOptional<UseParamsResult<TRouter, TFrom, TStrict, TSelected>, TThrow>;
export function useParams(options?: RuntimeRouteValueOptions): unknown {
  return useMatchSelection(
    options?.from,
    (match) =>
      options?.select === undefined
        ? match.params
        : options.select(match.params),
    options?.shouldThrow,
    options?.structuralSharing,
  );
}

export function useSearch(): AnyRouteMatch["search"];
export function useSearch<
  TRouter extends AnyRouter = RegisteredRouter,
  const TFrom extends string | undefined = undefined,
  TStrict extends boolean = true,
  TThrow extends boolean = true,
  TSelected = unknown,
>(
  options: TypedRouteValueOptions<
    TRouter,
    TFrom,
    TStrict,
    ResolveUseSearch<TRouter, TFrom, TStrict>,
    TSelected
  > & { shouldThrow?: ThrowConstraint<TStrict, TThrow> },
): ThrowOrOptional<UseSearchResult<TRouter, TFrom, TStrict, TSelected>, TThrow>;
export function useSearch(options?: RuntimeRouteValueOptions): unknown {
  return useMatchSelection(
    options?.from,
    (match) =>
      options?.select === undefined
        ? match.search
        : options.select(match.search),
    options?.shouldThrow,
    options?.structuralSharing,
  );
}

export function useLoaderData(): AnyRouteMatch["loaderData"];
export function useLoaderData<
  TRouter extends AnyRouter = RegisteredRouter,
  const TFrom extends string | undefined = undefined,
  TStrict extends boolean = true,
  TSelected = unknown,
>(
  options: TypedRouteValueOptions<
    TRouter,
    TFrom,
    TStrict,
    ResolveUseLoaderData<TRouter, TFrom, TStrict>,
    TSelected
  >,
): UseLoaderDataResult<TRouter, TFrom, TStrict, TSelected>;
export function useLoaderData(options?: RuntimeRouteValueOptions): unknown {
  return useMatchSelection(
    options?.from,
    (match) =>
      options?.select === undefined
        ? match.loaderData
        : options.select(match.loaderData),
    true,
    options?.structuralSharing,
  );
}

export function useLoaderDeps(): AnyRouteMatch["loaderDeps"];
export function useLoaderDeps<
  TRouter extends AnyRouter = RegisteredRouter,
  const TFrom extends RouteIds<TRouter["routeTree"]> = RouteIds<
    TRouter["routeTree"]
  >,
  TSelected = unknown,
>(
  options: FromRouteOptions<
    TFrom,
    ResolveUseLoaderDeps<TRouter, TFrom>,
    TSelected
  >,
): UseLoaderDepsResult<TRouter, TFrom, TSelected>;
export function useLoaderDeps(options?: RuntimeRouteValueOptions): unknown {
  return useMatchSelection(
    options?.from,
    (match) =>
      options?.select === undefined
        ? match.loaderDeps
        : options.select(match.loaderDeps),
    true,
    options?.structuralSharing,
  );
}

export function useRouteContext(): AnyRouteMatch["context"];
export function useRouteContext<
  TRouter extends AnyRouter = RegisteredRouter,
  const TFrom extends string | undefined = undefined,
  TStrict extends boolean = true,
  TSelected = unknown,
>(
  options: TypedRouteValueOptions<
    TRouter,
    TFrom,
    TStrict,
    UseRouteContextResult<TRouter, TFrom, TStrict, unknown>,
    TSelected
  >,
): UseRouteContextResult<TRouter, TFrom, TStrict, TSelected>;
export function useRouteContext(options?: RuntimeRouteValueOptions): unknown {
  return useMatchSelection(
    options?.from,
    (match) =>
      options?.select === undefined
        ? match.context
        : options.select(match.context),
    true,
    options?.structuralSharing,
  );
}

export function useNavigate<
  TRouter extends AnyRouter = RegisteredRouter,
  TDefaultFrom extends string = string,
>(options?: {
  from?: FromPathOption<TRouter, TDefaultFrom>;
}): UseNavigateResult<TDefaultFrom> {
  return useNavigateFrom(options?.from) as UseNavigateResult<TDefaultFrom>;
}

function useNavigateFrom(from: string | undefined): UseNavigateResult<string> {
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

export interface UseMatchesOptions<
  TRouter extends AnyRouter,
  TSelected,
> extends StructuralSharingOptions {
  select?: (matches: Array<MakeRouteMatchUnion<TRouter>>) => TSelected;
}

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

export interface MatchRouteFn<TRouter extends AnyRouter = RegisteredRouter> {
  <
    const TFrom extends string = string,
    const TTo extends string | undefined = undefined,
    const TMaskFrom extends string = TFrom,
    const TMaskTo extends string = "",
  >(
    options: UseMatchRouteOptions<TRouter, TFrom, TTo, TMaskFrom, TMaskTo>,
  ): false | Expand<ResolveRoute<TRouter, TFrom, TTo>["types"]["allParams"]>;
}

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

interface RouterTransitionState {
  active: boolean;
  generation: number;
  initialLoadStarted: boolean;
  phase: "idle" | "loading" | "loaded" | "mounting";
}

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
    { value: match.id },
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
    (matches: AnyRouteMatch[]) => buildScriptTags(router, matches),
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

function buildScriptTags(
  router: AnyRouter,
  matches: AnyRouteMatch[],
): RouterManagedTag[] {
  const manifest = router.ssr?.manifest;
  return matches.flatMap(
    (match) => collectRouteAssets(router, match, manifest).scripts,
  );
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
      const title = stringAttribute(Reflect.get(value, "title"));
      if (title !== undefined) {
        selectedTitle ??= { tag: "title", children: title };
        continue;
      }
      if (Reflect.has(value, "script:ld+json")) {
        try {
          metaTags.push({
            tag: "script",
            attrs: { type: "application/ld+json" },
            children: escapeHtml(
              JSON.stringify(Reflect.get(value, "script:ld+json")),
            ),
          });
        } catch {
          // Invalid JSON-LD is omitted, matching TanStack Router's adapters.
        }
        continue;
      }
      const identity =
        stringAttribute(Reflect.get(value, "name")) ??
        stringAttribute(Reflect.get(value, "property"));
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

function stringAttribute(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
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
type LinkStateProps = Partial<
  Omit<AnchorProps, "children" | "href" | "target">
>;

export interface LinkRenderState {
  isActive: boolean;
  isTransitioning: boolean;
}

export type LinkProps<
  TFrom extends string = string,
  TTo extends string | undefined = ".",
  TMaskFrom extends string = TFrom,
  TMaskTo extends string = ".",
> = Omit<AnchorProps, "children"> &
  LinkOptions<RegisteredRouter, TFrom, TTo, TMaskFrom, TMaskTo> & {
    activeProps?: LinkStateProps | (() => LinkStateProps);
    children?: FigNode | ((state: LinkRenderState) => FigNode);
    inactiveProps?: LinkStateProps | (() => LinkStateProps);
    preloadIntentProximity?: never;
  };

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
  const resolvedLocation = useReadableStore(router.stores.resolvedLocation);
  const currentLocation = resolvedLocation ?? router.stores.location.get();
  const [isTransitioning, setIsTransitioning] = useState(false);
  const transitionSubscription = useMemo<{ unsubscribe?: () => void }>(
    () => ({}),
    [],
  );
  useBeforePaint(
    (signal) => {
      signal.addEventListener(
        "abort",
        () => transitionSubscription.unsubscribe?.(),
        { once: true },
      );
      return undefined;
    },
    [transitionSubscription],
  );
  const {
    _fromLocation,
    activeOptions,
    activeProps,
    children,
    disabled,
    from: _from,
    hash: _hash,
    hashScrollIntoView: _hashScrollIntoView,
    href: explicitHref,
    ignoreBlocker: _ignoreBlocker,
    inactiveProps,
    mask: _mask,
    mix,
    params: _params,
    preload: requestedPreload,
    preloadDelay: requestedPreloadDelay,
    reloadDocument,
    replace: _replace,
    resetScroll: _resetScroll,
    search: _search,
    startTransition: _startTransition,
    state: _state,
    target,
    to,
    unsafeRelative: _unsafeRelative,
    viewTransition: _viewTransition,
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
  const stateProps = resolveLinkStateProps(
    isActive ? activeProps : inactiveProps,
  );
  const {
    bind: stateBind,
    class: stateClass,
    mix: stateMix,
    style: stateStyle,
    ...stateAnchorProps
  } = stateProps;
  const linkBind = composeBind(anchorProps.bind, stateBind);
  const linkClass = mergeLinkClass(anchorProps.class, stateClass);
  const linkStyle = mergeLinkStyle(anchorProps.style, stateStyle);
  const renderedChildren =
    typeof children === "function"
      ? children({ isActive, isTransitioning })
      : children;

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
      ...stateAnchorProps,
      "aria-current": isActive ? "page" : undefined,
      "aria-disabled": disabled ? true : undefined,
      "data-status": isActive ? "active" : undefined,
      "data-transitioning": isTransitioning ? "transitioning" : undefined,
      bind:
        preload === "viewport" ? composeBind(linkBind, viewportBind) : linkBind,
      class: linkClass,
      href: dangerous ? undefined : href,
      mix: [
        mix,
        stateMix,
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
          transitionSubscription.unsubscribe?.();
          setIsTransitioning(true);
          const unsubscribe = router.subscribe("onResolved", () => {
            unsubscribe();
            transitionSubscription.unsubscribe = undefined;
            setIsTransitioning(false);
          });
          transitionSubscription.unsubscribe = unsubscribe;
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
      role: disabled ? "link" : (stateAnchorProps.role ?? anchorProps.role),
      style: linkStyle,
      target,
    },
    renderedChildren,
  );
}

function resolveLinkStateProps(
  props: LinkStateProps | (() => LinkStateProps) | undefined,
): LinkStateProps {
  return (typeof props === "function" ? props() : props) ?? {};
}

function mergeLinkClass(
  base: AnchorProps["class"],
  state: AnchorProps["class"],
): AnchorProps["class"] {
  if (typeof base === "string" && typeof state === "string") {
    return `${base} ${state}`;
  }
  return state ?? base;
}

function mergeLinkStyle(
  base: AnchorProps["style"],
  state: AnchorProps["style"],
): AnchorProps["style"] {
  if (
    typeof base === "object" &&
    base !== null &&
    typeof state === "object" &&
    state !== null
  ) {
    return { ...base, ...state };
  }
  return state ?? base;
}

function selectStoreValue<TValue>(value: TValue): TValue {
  return value;
}

function useReadableStore<TValue>(store: RouterReadableStore<TValue>): TValue;
function useReadableStore<TValue, TSelected>(
  store: RouterReadableStore<TValue>,
  select: (value: TValue) => TSelected,
  equal?: (previous: TSelected, next: TSelected) => boolean,
): TSelected;
function useReadableStore<TValue, TSelected = TValue>(
  store: RouterReadableStore<TValue>,
  select: (value: TValue) => TSelected = selectStoreValue as (
    value: TValue,
  ) => TSelected,
  equal: (previous: TSelected, next: TSelected) => boolean = Object.is,
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
      const nextSelected = select(nextSource);
      source = nextSource;
      if (initialized && equal(selected, nextSelected)) return selected;
      selected = nextSelected;
      initialized = true;
      return selected;
    };
  }, [equal, select, store]);
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
