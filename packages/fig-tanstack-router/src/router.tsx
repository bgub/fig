export {
  createBrowserHistory,
  createHashHistory,
  createMemoryHistory,
} from "@tanstack/history";
export type { RouterHistory } from "@tanstack/history";
export { ensureRouteData } from "./data-context.ts";
export type { RouteDataContext } from "./data-context.ts";
export {
  defaultParseSearch,
  defaultStringifySearch,
  isNotFound,
  isRedirect,
  lazyFn,
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
export {
  MatchRoute,
  Navigate,
  useBlocker,
  useCanGoBack,
  useLoaderData,
  useLoaderDeps,
  useLocation,
  useMatch,
  useMatches,
  useMatchRoute,
  useNavigate,
  useParams,
  useRouteContext,
  useRouter,
  useRouterState,
  useSearch,
} from "./hooks.tsx";
export type {
  MakeMatchRouteOptions,
  MatchRouteFn,
  ShouldBlockFn,
  UseBlockerOpts,
  UseMatchesOptions,
  UseMatchesResult,
  UseMatchRouteOptions,
} from "./hooks.tsx";
export { Link } from "./link.tsx";
export type { LinkProps, LinkRenderState } from "./link.tsx";
export {
  HeadContent,
  Matches,
  Outlet,
  RouterProvider,
  Scripts,
} from "./matches.tsx";
export type { RouterProviderProps } from "./matches.tsx";
export {
  createFileRoute,
  createLazyFileRoute,
  createRootRoute,
  createRootRouteWithContext,
  createRoute,
  createRouteMask,
  createRouter,
  getRouteApi,
  lazyRouteComponent,
  linkOptions,
} from "./route.tsx";
export type {
  AsyncRouteComponent,
  ErrorRouteComponent,
  FileRoutesByPath,
  LinkComponentRoute,
  LinkOptionsFnOptions,
  NotFoundRouteComponent,
  RouteApiMethods,
  RouteComponent,
  RouteErrorComponentProps,
  UseLoaderDataRoute,
  UseLoaderDepsRoute,
  UseMatchRoute,
  UseParamsRoute,
  UseRouteContextRoute,
  UseSearchRoute,
} from "./route.tsx";
