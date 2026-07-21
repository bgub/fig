import {
  createElement,
  type ComponentType,
  type ErrorInfo,
  type FigNode,
  type Props,
  readPromise,
} from "@bgub/fig";
import type { RouterHistory } from "@tanstack/history";
import {
  type AnyContext,
  type AnyRoute,
  type AnyRouter,
  type AssetCrossOriginConfig,
  BaseRootRoute,
  BaseRoute,
  BaseRouteApi,
  type Constrain,
  type ConstrainLiteral,
  type CreateFileRoute,
  type CreateLazyFileRoute,
  type FileRoutesByPath as CoreFileRoutesByPath,
  type InferFrom,
  type InferMaskFrom,
  type InferMaskTo,
  type InferTo,
  type LinkOptions,
  type MakeRouteMatch,
  type NotFoundError,
  type NotFoundRouteProps,
  notFound as createNotFound,
  type Register,
  type RegisteredRouter,
  type ResolveFullPath,
  type ResolveId,
  type ResolveParams,
  type ResolveUseLoaderData,
  type ResolveUseLoaderDeps,
  type ResolveUseParams,
  type ResolveUseSearch,
  type RootRouteId,
  type RootRouteOptions,
  type RouteConstraints,
  type RouteIds,
  type RouteMask,
  type RouteOptions,
  type RouteTypesById,
  RouterCore,
  type RouterConstructorOptions,
  type ToMaskOptions,
  type TrailingSlashOption,
  type UseLoaderDataResult,
  type UseLoaderDepsResult,
  type UseNavigateResult,
  type UseParamsResult,
  type UseRouteContextResult,
  type UseSearchResult,
} from "@tanstack/router-core";
import { dataStoreFromContext } from "./data-context.ts";
import {
  type RouteMatchResult,
  type SelectRouteValue,
  useMatchValue,
  useNavigateFrom,
  useRouter,
} from "./hooks.tsx";
import { Link, type LinkProps } from "./link.tsx";
import { getStoreConfig } from "./store.ts";

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

export type RouteErrorComponentProps = {
  error: unknown;
  reset: () => void;
};

export type RouteComponent = ComponentType;
export type ErrorRouteComponent = ComponentType<RouteErrorComponentProps>;
export type NotFoundRouteComponent = ComponentType<NotFoundRouteProps>;

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

export type RouteApiMethods<TId extends string, TFullPath extends string> = {
  Link: LinkComponentRoute<TFullPath>;
  notFound: (options?: NotFoundError) => NotFoundError;
  useLoaderData: UseLoaderDataRoute<TId>;
  useLoaderDeps: UseLoaderDepsRoute<TId>;
  useMatch: UseMatchRoute<TId>;
  useNavigate: () => UseNavigateResult<TFullPath>;
  useParams: UseParamsRoute<TId>;
  useRouteContext: UseRouteContextRoute<TId>;
  useSearch: UseSearchRoute<TId>;
};

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
      useMatchValue(getId(), options, (match) => match.loaderData) as never,
    useLoaderDeps: (options) =>
      useMatchValue(getId(), options, (match) => match.loaderDeps) as never,
    useMatch: (options) =>
      useMatchValue(getId(), options, (match) => match) as never,
    useNavigate: () => useNavigateFrom(useFullPath()) as never,
    useParams: (options) =>
      useMatchValue(getId(), options, (match) => match.params) as never,
    useRouteContext: (options) =>
      useMatchValue(getId(), options, (match) => match.context) as never,
    useSearch: (options) =>
      useMatchValue(getId(), options, (match) => match.search) as never,
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
  return new RouterCore(
    options.defaultPreloadStaleTime === undefined &&
      dataStoreFromContext(options.context) !== undefined
      ? { ...options, defaultPreloadStaleTime: 0 }
      : options,
    getStoreConfig,
  );
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
    const route = attachRouteApi(new BaseRoute(options as never));
    route.isRoot = false as never;
    return route as never;
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
      const imported = module[exportName];
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
