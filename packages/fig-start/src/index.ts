// Apps augment this to register their router context type once, app-wide:
//   declare module "@bgub/fig-start" {
//     interface Register { context: { queryClient: QueryClient } }
//   }
// Route `beforeLoad`/`loader` args then see the typed context with no codegen.
// The framework owns the plumbing only; the app decides what the context holds.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Register {}

export type RegisteredContext = Register extends { context: infer C }
  ? C
  : unknown;

export {
  Link,
  type LinkProps,
  Outlet,
  RouterProvider,
  useLocation,
  useNavigate,
  useParams,
  useRouter,
  useRouterState,
} from "./components.tsx";
export type {
  NavigateOptions,
  RouteMatch,
  RouteNode,
  Router,
  RouterState,
} from "./core.ts";
export {
  isRedirect,
  type Redirect,
  redirect,
  type RedirectOptions,
} from "./redirect.ts";
export {
  type AnyRoute,
  createFileRoute,
  createRootRoute,
  type Route,
} from "./route.ts";
export {
  type CreateRouterOptions,
  createRouter,
  type FigRouter,
  type LoadResult,
  type RouterHistory,
} from "./router.ts";
export { buildRouteTree, matchRoutes } from "./tree.ts";
export type {
  BeforeLoadArgs,
  LoaderArgs,
  RouteComponent,
  RouteOptions,
  RouterLocation,
} from "./types.ts";
