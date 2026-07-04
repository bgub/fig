import {
  createContext,
  createElement,
  type FigNode,
  readContext,
  Suspense,
  useBeforeLayout,
  useCallback,
  useExternalStore,
} from "@bgub/fig";
import { PAYLOAD_SLOT_ATTR } from "./bootstrap.ts";
import type { NavigateOptions, Router } from "./core.ts";
import { isServerRoute } from "./internal.ts";
import { hrefFrom } from "./location.ts";
import type { RouterLocation } from "./types.ts";
import { RouterContext, useRouter, useRouterState } from "./router-context.ts";

// Tracks how deep into the matched chain we are. Each rendered route component
// is wrapped one level deeper, so an <Outlet/> inside it renders the next match.
const MatchDepthContext = createContext(0);
type ServerRouteRenderMode = "content" | "document" | "placeholder";
const ServerRouteRenderModeContext =
  createContext<ServerRouteRenderMode>("placeholder");
export interface ServerRouteContentStore {
  commit(routeId: string): void;
  getSnapshot(routeId: string): number;
  render(routeId: string): FigNode;
  subscribe(routeId: string, listener: () => void): () => void;
}

const ServerRouteContentContext = createContext<ServerRouteContentStore | null>(
  null,
);

export function RouterProvider(props: { router: Router }): FigNode {
  return createElement(
    RouterContext,
    { value: props.router },
    createElement(Outlet),
  );
}

export function ServerRouteRenderProvider(props: {
  children?: FigNode;
  depth?: number;
  mode: Exclude<ServerRouteRenderMode, "placeholder">;
}): FigNode {
  return createElement(
    ServerRouteRenderModeContext,
    { value: props.mode },
    createElement(
      MatchDepthContext,
      { value: props.depth ?? 0 },
      props.children,
    ),
  );
}

export function ServerRouteContentProvider(props: {
  children?: FigNode;
  store: ServerRouteContentStore;
}): FigNode {
  return createElement(
    ServerRouteContentContext,
    { value: props.store },
    props.children,
  );
}

export function Outlet(): FigNode {
  const depth = readContext(MatchDepthContext);
  const state = useRouterState();
  const match = state.matches[depth];

  if (match === undefined) {
    if (state.notFound) {
      const root = state.matches[0]?.node.route;
      const NotFound = root?.options.notFoundComponent;
      return NotFound === undefined ? "Not found" : createElement(NotFound, {});
    }
    return null;
  }

  const serverRouteMode = readContext(ServerRouteRenderModeContext);
  const serverRoute = isServerRoute(match.node.route);
  if (serverRoute && serverRouteMode === "placeholder")
    return createElement(ServerRouteSlot, { routeId: match.routeId });

  const Component = match.node.route.options.component;
  const child =
    Component === undefined
      ? createElement(Outlet)
      : createElement(Component, {});

  const rendered = createElement(
    MatchDepthContext,
    { value: depth + 1 },
    child,
  );
  return serverRoute && serverRouteMode === "document"
    ? createElement(
        "div",
        { [PAYLOAD_SLOT_ATTR]: match.routeId },
        createElement(
          Suspense,
          { fallback: null },
          createElement(ServerRouteContent, {
            fallback: rendered,
            routeId: match.routeId,
          }),
        ),
      )
    : rendered;
}

function ServerRouteSlot(props: { routeId: string }): FigNode {
  return createElement(
    "div",
    { [PAYLOAD_SLOT_ATTR]: props.routeId },
    createElement(ServerRouteContent, { routeId: props.routeId }),
  );
}

function ServerRouteContent(props: {
  fallback?: FigNode;
  routeId: string;
}): FigNode {
  const store = readContext(ServerRouteContentContext);
  const getSnapshot = () => store?.getSnapshot(props.routeId) ?? 0;
  const snapshot = useExternalStore(
    (listener) =>
      store === null
        ? () => undefined
        : store.subscribe(props.routeId, listener),
    getSnapshot,
    getSnapshot,
  );
  useBeforeLayout(() => {
    store?.commit(props.routeId);
    return undefined;
  }, [props.routeId, snapshot, store]);

  return store?.render(props.routeId) ?? props.fallback ?? null;
}

export interface LinkProps {
  [attribute: string]: unknown;
  children?: FigNode;
  hash?: string;
  replace?: boolean;
  search?: string;
  to: string;
}

export function Link(props: LinkProps): FigNode {
  const { hash, replace, search, to, children, ...rest } = props;

  // Isomorphic: a plain <a> marked for the client's global click interceptor, so
  // this component pulls in no DOM-only imports and renders identically on the
  // server.
  return createElement(
    "a",
    {
      ...rest,
      "data-fig-link": replace === true ? "replace" : "true",
      href: hrefFrom(to, search, hash),
    },
    children,
  );
}

export function useNavigate(): (to: NavigateOptions | string) => Promise<void> {
  const router = useRouter();
  return useCallback(
    (to: NavigateOptions | string) => router.navigate(to),
    [router],
  );
}

export function useLocation(): RouterLocation {
  return useRouterState().location;
}

export function useParams(): Record<string, string> {
  return useRouterState().params;
}

export { useRouter, useRouterState };
