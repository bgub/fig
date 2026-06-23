import type { FigNode } from "@bgub/fig";
import type { RouteParams } from "./path-types.ts";
import type { RegisteredContext } from "./index.ts";

export type { RegisteredContext } from "./index.ts";

export interface RouterLocation {
  hash: string;
  href: string;
  pathname: string;
  search: string;
}

export type RouteComponent = () => FigNode;

export interface BeforeLoadArgs<TParams> {
  context: RegisteredContext;
  location: RouterLocation;
  params: TParams;
}

export interface LoaderArgs<TParams> {
  context: RegisteredContext;
  location: RouterLocation;
  params: TParams;
}

export interface RouteOptions<TPath extends string, TLoaderData> {
  beforeLoad?: (args: BeforeLoadArgs<RouteParams<TPath>>) => unknown;
  // A server (RSC) route: its `component` renders through Fig's RSC stream on the
  // server and never ships to the client (a `.server.tsx` file). It receives
  // { params, loaderData } as props rather than using router hooks, and may
  // import `.tsx` components that become interactive client islands.
  component?: RouteComponent;
  errorComponent?: (props: { error: unknown }) => FigNode;
  loader?: (args: LoaderArgs<RouteParams<TPath>>) => TLoaderData;
  notFoundComponent?: RouteComponent;
  pendingComponent?: RouteComponent;
  server?: boolean;
}

// A loader may return data (typed by useLoaderData) or a promise of it; for the
// preload-then-readData pattern it returns void.
export type LoaderData<TLoaderData> = Awaited<TLoaderData>;
