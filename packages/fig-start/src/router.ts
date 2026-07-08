import { transition } from "@bgub/fig";
import type {
  NavigateOptions,
  RouteMatch,
  RouteNode,
  Router,
  RouterState,
} from "./core.ts";
import { hrefFrom, parseLocation } from "./location.ts";
import { isRedirect, type Redirect } from "./redirect.ts";
import { type AnyRoute } from "./route.ts";
import { buildRouteTree, matchRoutes } from "./tree.ts";
import type { RouterLocation } from "./types.ts";

export interface RouterHistory {
  push(href: string): void;
  replace(href: string): void;
}

export interface CreateRouterOptions {
  // Awaited between a successful load and the state commit. Client
  // navigation uses it to prefetch server-route payloads so the previous
  // page stays visible until the next one can render.
  beforeCommit?: (
    location: RouterLocation,
    result: LoadResult,
  ) => Promise<void> | void;
  context?: unknown;
  history?: RouterHistory;
  routes: readonly AnyRoute[];
}

export type LoadResult =
  | { matches: RouteMatch[]; params: Record<string, string>; status: "match" }
  | { redirect: Redirect; status: "redirect" }
  | { status: "notFound" };

export interface FigRouter extends Router {
  readonly context: unknown;
  readonly tree: RouteNode;
  commit(location: RouterLocation, result: LoadResult): void;
  hydrate(location: RouterLocation, loaderData: Record<string, unknown>): void;
  load(location: RouterLocation): Promise<LoadResult>;
  sync(location: RouterLocation): Promise<void>;
}

export function createRouter(options: CreateRouterOptions): FigRouter {
  const tree = buildRouteTree(options.routes);
  const baseContext = options.context ?? {};
  const beforeCommit = options.beforeCommit ?? null;
  const history = options.history ?? null;
  const listeners = new Set<() => void>();

  let state: RouterState = {
    location: parseLocation("/"),
    matches: [],
    notFound: false,
    params: {},
    status: "idle",
  };

  const getState = (): RouterState => state;

  function setState(next: RouterState, notify = true): void {
    state = next;
    if (!notify) return;
    for (const listener of listeners) listener();
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function buildLocation(to: NavigateOptions | string): RouterLocation {
    const options = typeof to === "string" ? { to } : to;
    return parseLocation(hrefFrom(options.to, options.search, options.hash));
  }

  async function load(location: RouterLocation): Promise<LoadResult> {
    const matched = matchRoutes(tree, location.pathname);
    if (matched === null) return { status: "notFound" };

    try {
      let context = baseContext;
      const matches: RouteMatch[] = [];

      // beforeLoad runs parent -> child so each route sees its ancestors' context.
      for (const entry of matched) {
        const beforeLoad = entry.node.route.options.beforeLoad;
        if (beforeLoad !== undefined) {
          const added = await beforeLoad({
            context: context as never,
            location,
            params: entry.params as never,
          });
          if (added !== null && typeof added === "object") {
            context = { ...(context as object), ...added };
          }
        }
        matches.push({
          context,
          loaderData: undefined,
          node: entry.node,
          params: entry.params,
          routeId: entry.node.id,
        });
      }

      // Loaders run in parallel: their context is already resolved.
      await Promise.all(
        matches.map(async (match) => {
          const loader = match.node.route.options.loader;
          if (loader === undefined) return;
          match.loaderData = await loader({
            context: match.context as never,
            location,
            params: match.params as never,
          });
        }),
      );

      return {
        matches,
        params: matched.at(-1)?.params ?? {},
        status: "match",
      };
    } catch (error) {
      if (isRedirect(error)) return { redirect: error, status: "redirect" };
      throw error;
    }
  }

  function rootMatch(): RouteMatch {
    return {
      context: baseContext,
      loaderData: undefined,
      node: tree,
      params: {},
      routeId: tree.id,
    };
  }

  function commit(location: RouterLocation, result: LoadResult): void {
    if (result.status === "match") {
      setState({
        location,
        matches: result.matches,
        notFound: false,
        params: result.params,
        status: "idle",
      });
      return;
    }
    // notFound (redirects are resolved by the caller, never committed).
    setState({
      location,
      matches: [rootMatch()],
      notFound: true,
      params: {},
      status: "idle",
    });
  }

  function hydrate(
    location: RouterLocation,
    loaderData: Record<string, unknown>,
  ): void {
    const matched = matchRoutes(tree, location.pathname);
    if (matched === null) {
      setState({
        location,
        matches: [rootMatch()],
        notFound: true,
        params: {},
        status: "idle",
      });
      return;
    }
    setState({
      location,
      matches: matched.map((entry) => ({
        context: baseContext,
        loaderData: loaderData[entry.node.id],
        node: entry.node,
        params: entry.params,
        routeId: entry.node.id,
      })),
      notFound: false,
      params: matched.at(-1)?.params ?? {},
      status: "idle",
    });
  }

  // Loads (and beforeCommit prefetches) can be slow and overlap: only the
  // most recently started navigation may commit; superseded ones return
  // without touching state or history.
  let navigationVersion = 0;

  async function transitionTo(
    location: RouterLocation,
    options: { replace?: boolean; updateHistory: boolean },
  ): Promise<void> {
    const version = ++navigationVersion;
    await transition(async () => {
      setState({ ...state, status: "pending" });
      const result = await load(location);
      if (version !== navigationVersion) return;

      if (result.status === "redirect") {
        await navigate({ replace: options.replace, to: result.redirect.to });
        return;
      }

      await beforeCommit?.(location, result);
      if (version !== navigationVersion) return;

      if (options.updateHistory && history !== null) {
        if (options.replace === true) history.replace(location.href);
        else history.push(location.href);
      }
      commit(location, result);
    });
  }

  function navigate(to: NavigateOptions | string): Promise<void> {
    const options = typeof to === "string" ? { to } : to;
    return transitionTo(buildLocation(options), {
      replace: options.replace,
      updateHistory: true,
    });
  }

  // For popstate: the browser already updated the URL, so load and commit
  // (with the same superseding and beforeCommit rules) without pushing.
  function sync(location: RouterLocation): Promise<void> {
    return transitionTo(location, { replace: true, updateHistory: false });
  }

  return {
    buildLocation,
    commit,
    context: baseContext,
    getState,
    hydrate,
    load,
    navigate,
    subscribe,
    sync,
    tree,
  };
}
