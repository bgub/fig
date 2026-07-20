import {
  assets,
  createContext,
  createElement,
  type ComponentType,
  type DataResource,
  ErrorBoundary,
  type FigAssetResource,
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
import {
  assetResourceDestination,
  assetResourceFromHostProps,
  preventAssetResourceHoist,
} from "@bgub/fig/internal";
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
  appendUniqueUserTags,
  type AssetCrossOriginConfig,
  BaseRootRoute,
  BaseRoute,
  BaseRouteApi,
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
  getAssetCrossOrigin,
  getLocationChangeInfo,
  getScriptPreloadAttrs,
  isDangerousProtocol,
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
  removeTrailingSlash,
  resolveManifestCssLink,
  type RegisteredRouter,
  type Register,
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
  RouterCore,
  type RouterConstructorOptions,
  type RouterReadableStore,
  type RouterManagedTag,
  type RouterState,
  type RouteConstraints,
  type RouteIds,
  type RouteOptions,
  type RouteTypesById,
  type ToSubOptionsProps,
  type TrailingSlashOption,
  type UseLoaderDataResult,
  type UseLoaderDepsResult,
  type UseNavigateResult,
  type UseParamsResult,
  type UseRouteContextResult,
  type UseSearchResult,
} from "@tanstack/router-core";
import { batch } from "@tanstack/store";
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

interface SelectRouteValue<TValue, TSelected> {
  select?: (value: TValue) => TSelected;
}

type RouteMatchResult<
  TRouter extends AnyRouter,
  TFrom,
  TSelected,
> = unknown extends TSelected
  ? MakeRouteMatch<TRouter["routeTree"], TFrom, true>
  : TSelected;

export type UseMatchRoute<out TFrom> = <
  TRouter extends AnyRouter = RegisteredRouter,
  TSelected = unknown,
>(
  options?: SelectRouteValue<
    MakeRouteMatch<TRouter["routeTree"], TFrom, true>,
    TSelected
  >,
) => RouteMatchResult<TRouter, TFrom, TSelected>;

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
      useMatchSelection(getId(), (match) =>
        options?.select === undefined
          ? match.loaderData
          : options.select(match.loaderData as never),
      ) as never,
    useLoaderDeps: (options) =>
      useMatchSelection(getId(), (match) =>
        options?.select === undefined
          ? match.loaderDeps
          : options.select(match.loaderDeps as never),
      ) as never,
    useMatch: (options) =>
      useMatchSelection(getId(), (match) =>
        options?.select === undefined ? match : options.select(match as never),
      ) as never,
    useNavigate: () => useNavigateFrom(useFullPath()) as never,
    useParams: (options) =>
      useMatchSelection(getId(), (match) =>
        options?.select === undefined
          ? match.params
          : options.select(match.params as never),
      ) as never,
    useRouteContext: (options) =>
      useMatchSelection(getId(), (match) =>
        options?.select === undefined
          ? match.context
          : options.select(match.context as never),
      ) as never,
    useSearch: (options) =>
      useMatchSelection(getId(), (match) =>
        options?.select === undefined
          ? match.search
          : options.select(match.search as never),
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

export function getRouteApi<
  const TId extends string,
  TRouter extends AnyRouter = RegisteredRouter,
>(id: ConstrainLiteral<TId, RouteIds<TRouter["routeTree"]>>) {
  return new RouteApi<TId, TRouter>({ id });
}

export class RouteApi<
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
  const TFrom extends RouteIds<TRouter["routeTree"]> = RouteIds<
    TRouter["routeTree"]
  >,
  TSelected = unknown,
>(
  options: FromRouteOptions<
    TFrom,
    MakeRouteMatch<TRouter["routeTree"], TFrom, true>,
    TSelected
  >,
): RouteMatchResult<TRouter, TFrom, TSelected>;
export function useMatch(options?: MatchOptions<AnyRouteMatch>): AnyRouteMatch;
export function useMatch<TSelected>(
  options: MatchOptions<TSelected> & {
    select: (match: AnyRouteMatch) => TSelected;
  },
): TSelected;
export function useMatch(options?: MatchOptions<unknown>): unknown {
  return useMatchSelection(options?.from, options?.select);
}

function useMatchSelection(
  from: string | undefined,
  select: ((match: AnyRouteMatch) => unknown) | undefined,
): unknown {
  const router = useRouter<AnyRouter>();
  const nearestMatchId = readContext(MatchContext);
  const store = from
    ? router.stores.getRouteMatchStore(from)
    : nearestMatchId === null
      ? undefined
      : router.stores.matchStores.get(nearestMatchId);

  if (store === undefined) throwMissingMatch(from);

  const selected = useReadableStore(store, (match) => {
    if (match === undefined) return missingMatch;
    return select === undefined ? match : select(match);
  });
  if (selected === missingMatch) throwMissingMatch(from);
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
  TSelected = unknown,
>(
  options: FromRouteOptions<
    TFrom,
    ResolveUseParams<TRouter, TFrom, true>,
    TSelected
  >,
): UseParamsResult<TRouter, TFrom, true, TSelected>;
export function useParams(
  options?: FromRouteOptions<string, unknown, unknown>,
): unknown {
  return useMatch({
    from: options?.from,
    select: (match) =>
      options?.select === undefined
        ? match.params
        : options.select(match.params),
  });
}

export function useSearch(): AnyRouteMatch["search"];
export function useSearch<
  TRouter extends AnyRouter = RegisteredRouter,
  const TFrom extends RouteIds<TRouter["routeTree"]> = RouteIds<
    TRouter["routeTree"]
  >,
  TSelected = unknown,
>(
  options: FromRouteOptions<
    TFrom,
    ResolveUseSearch<TRouter, TFrom, true>,
    TSelected
  >,
): UseSearchResult<TRouter, TFrom, true, TSelected>;
export function useSearch(
  options?: FromRouteOptions<string, unknown, unknown>,
): unknown {
  return useMatch({
    from: options?.from,
    select: (match) =>
      options?.select === undefined
        ? match.search
        : options.select(match.search),
  });
}

export function useLoaderData(): AnyRouteMatch["loaderData"];
export function useLoaderData<
  TRouter extends AnyRouter = RegisteredRouter,
  const TFrom extends RouteIds<TRouter["routeTree"]> = RouteIds<
    TRouter["routeTree"]
  >,
  TSelected = unknown,
>(
  options: FromRouteOptions<
    TFrom,
    ResolveUseLoaderData<TRouter, TFrom, true>,
    TSelected
  >,
): UseLoaderDataResult<TRouter, TFrom, true, TSelected>;
export function useLoaderData(
  options?: FromRouteOptions<string, unknown, unknown>,
): unknown {
  return useMatch({
    from: options?.from,
    select: (match) =>
      options?.select === undefined
        ? match.loaderData
        : options.select(match.loaderData),
  });
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
export function useLoaderDeps(
  options?: FromRouteOptions<string, unknown, unknown>,
): unknown {
  return useMatch({
    from: options?.from,
    select: (match) =>
      options?.select === undefined
        ? match.loaderDeps
        : options.select(match.loaderDeps),
  });
}

export function useRouteContext(): AnyRouteMatch["context"];
export function useRouteContext<
  TRouter extends AnyRouter = RegisteredRouter,
  const TFrom extends RouteIds<TRouter["routeTree"]> = RouteIds<
    TRouter["routeTree"]
  >,
  TSelected = unknown,
>(
  options: FromRouteOptions<
    TFrom,
    UseRouteContextResult<TRouter, TFrom, true, unknown>,
    TSelected
  >,
): UseRouteContextResult<TRouter, TFrom, true, TSelected>;
export function useRouteContext(
  options?: FromRouteOptions<string, unknown, unknown>,
): unknown {
  return useMatch({
    from: options?.from,
    select: (match) =>
      options?.select === undefined
        ? match.context
        : options.select(match.context),
  });
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

export interface UseMatchesOptions<TRouter extends AnyRouter, TSelected> {
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
  return useReadableStore(
    router.stores.matches,
    (matches) =>
      options?.select === undefined
        ? matches
        : options.select(matches as Array<MakeRouteMatchUnion<TRouter>>),
    deepEqual,
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

export interface HeadContentProps {
  assetCrossOrigin?: AssetCrossOriginConfig;
}

export function HeadContent({ assetCrossOrigin }: HeadContentProps): FigNode {
  const router = useRouter<AnyRouter>();
  const selectTags = useCallback(
    (matches: AnyRouteMatch[]) =>
      buildHeadTags(router, matches, assetCrossOrigin),
    [assetCrossOrigin, router],
  );
  const tags = useReadableStore(router.stores.matches, selectTags, deepEqual);
  return renderHeadTags(tags);
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
  return tags.map(renderManagedTag);
}

function buildScriptTags(
  router: AnyRouter,
  matches: AnyRouteMatch[],
): RouterManagedTag[] {
  const nonce = router.options.ssr?.nonce;
  const tags: RouterManagedTag[] = matches.flatMap((match) =>
    (match.scripts ?? [])
      .filter((script) => script !== undefined)
      .map(({ children, ...attrs }) => ({
        tag: "script" as const,
        attrs: { ...attrs, nonce, suppressHydrationWarning: true },
        children: children as string | undefined,
      })),
  );
  const manifest = router.ssr?.manifest;
  if (manifest === undefined) return tags;

  for (const match of matches) {
    for (const script of manifest.routes[match.routeId]?.scripts ?? []) {
      tags.push({
        tag: "script",
        attrs: { ...script.attrs, nonce },
        children: script.children,
      });
    }
  }
  return tags;
}

function buildHeadTags(
  router: AnyRouter,
  matches: AnyRouteMatch[],
  assetCrossOrigin?: AssetCrossOriginConfig,
): RouterManagedTag[] {
  const nonce = router.options.ssr?.nonce;
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
  const manifest = router.ssr?.manifest;
  if (manifest !== undefined) {
    for (const match of matches) {
      for (const link of manifest.routes[match.routeId]?.preloads ?? []) {
        tags.push({
          tag: "link",
          attrs: {
            ...getScriptPreloadAttrs(manifest, link, assetCrossOrigin),
            nonce,
          },
        });
      }
    }
  }
  appendUniqueUserTags(
    tags,
    matches.flatMap((match) =>
      (match.links ?? [])
        .filter((link) => link !== undefined)
        .map((link) => ({
          tag: "link" as const,
          attrs: { ...link, nonce },
        })),
    ),
  );
  if (manifest !== undefined) {
    for (const match of matches) {
      for (const link of manifest.routes[match.routeId]?.css ?? []) {
        const resolvedLink = resolveManifestCssLink(link);
        tags.push({
          tag: "link",
          attrs: {
            rel: "stylesheet",
            ...resolvedLink,
            crossOrigin:
              getAssetCrossOrigin(assetCrossOrigin, "stylesheet") ??
              resolvedLink.crossOrigin,
            nonce,
            suppressHydrationWarning: true,
          },
        });
      }
    }
    if (manifest.inlineStyle !== undefined) {
      tags.push({
        tag: "style",
        attrs: { ...manifest.inlineStyle.attrs, nonce },
        children: manifest.inlineStyle.children,
        inlineCss: true,
      });
    }
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
    matches.flatMap((match) =>
      (match.headScripts ?? [])
        .filter((script) => script !== undefined)
        .map(({ children, ...attrs }) => ({
          tag: "script" as const,
          attrs: { ...attrs, nonce },
          children: children as string | undefined,
        })),
    ),
  );
  return tags;
}

function renderHeadTags(tags: RouterManagedTag[]): FigNode {
  const resources: FigAssetResource[] = [];
  const nodes: FigNode[] = [];
  for (const tag of tags) {
    const resource = assetResourceFromHostProps(tag.tag, {
      ...nativeAttributes(tag.attrs),
      children: tag.children,
    });
    if (resource === null || assetResourceDestination(resource) !== "head") {
      nodes.push(renderManagedTag(tag));
    } else {
      resources.push(resource);
    }
  }
  return resources.length === 0 ? nodes : assets(resources, nodes);
}

function renderManagedTag(tag: RouterManagedTag): FigNode {
  const attrs = nativeAttributes(tag.attrs);
  return createElement(
    tag.tag,
    preventAssetResourceHoist({
      ...attrs,
      ...(tag.children === undefined ? {} : { unsafeHTML: tag.children }),
    }),
  );
}

function nativeAttributes(
  attrs: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (attrs === undefined) return {};
  const result = { ...attrs };
  renameAttribute(result, "charSet", "charset");
  renameAttribute(result, "className", "class");
  renameAttribute(result, "crossOrigin", "crossorigin");
  renameAttribute(result, "fetchPriority", "fetchpriority");
  renameAttribute(result, "httpEquiv", "http-equiv");
  renameAttribute(result, "referrerPolicy", "referrerpolicy");
  return result;
}

function renameAttribute(
  attrs: Record<string, unknown>,
  from: string,
  to: string,
): void {
  if (attrs[from] !== undefined && attrs[to] === undefined) {
    attrs[to] = attrs[from];
  }
  delete attrs[from];
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
  const resolvedLocation = useReadableStore(router.stores.resolvedLocation);
  const currentLocation = resolvedLocation ?? router.stores.location.get();
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
