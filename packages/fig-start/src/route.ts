import type { RouteMatch } from "./core.ts";
import type { RouteParams } from "./path-types.ts";
import { useRouterState } from "./router-context.ts";
import type { LoaderData, RegisteredContext, RouteOptions } from "./types.ts";

export const ROOT_ROUTE_ID = "__root__";

export interface Route<TPath extends string, TLoaderData> {
  readonly id: string;
  readonly isRoot: boolean;
  readonly options: RouteOptions<TPath, TLoaderData>;
  readonly path: TPath;
  useLoaderData(): LoaderData<TLoaderData>;
  useMatch(): RouteMatch;
  useParams(): RouteParams<TPath>;
  useRouteContext(): RegisteredContext;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRoute = Route<any, any>;

// `createFileRoute("/posts/$postId")({ loader, component })` — the path string is
// the route id (TanStack-style). TLoaderData is inferred from the loader return,
// so Route.useLoaderData() is typed with no codegen.
export function createFileRoute<TPath extends string>(path: TPath) {
  return function defineRoute<TLoaderData = void>(
    options: RouteOptions<TPath, TLoaderData> = {},
  ): Route<TPath, TLoaderData> {
    return makeRoute(path, path, false, options);
  };
}

export function createRootRoute<TLoaderData = void>(
  options: RouteOptions<"", TLoaderData> = {},
): Route<"", TLoaderData> {
  return makeRoute(ROOT_ROUTE_ID, "", true, options);
}

function makeRoute<TPath extends string, TLoaderData>(
  id: string,
  path: TPath,
  isRoot: boolean,
  options: RouteOptions<TPath, TLoaderData>,
): Route<TPath, TLoaderData> {
  function useMatch(): RouteMatch {
    const state = useRouterState();
    const match = state.matches.find((entry) => entry.routeId === id);
    if (match === undefined) {
      throw new Error(`Route "${id}" is not active in the current location.`);
    }
    return match;
  }

  return {
    id,
    isRoot,
    options,
    path,
    useMatch,
    useLoaderData: () => useMatch().loaderData as LoaderData<TLoaderData>,
    useParams: () => useRouterState().params as RouteParams<TPath>,
    useRouteContext: () => useMatch().context as RegisteredContext,
  };
}
