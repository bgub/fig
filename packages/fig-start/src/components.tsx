import {
  createContext,
  createElement,
  type FigNode,
  readContext,
  useCallback,
} from "@bgub/fig";
import { RSC_SLOT_ATTR } from "./bootstrap.ts";
import type { NavigateOptions, Router } from "./core.ts";
import { isServerRoute } from "./internal.ts";
import { hrefFrom } from "./location.ts";
import type { RouterLocation } from "./types.ts";
import { RouterContext, useRouter, useRouterState } from "./router-context.ts";

// Tracks how deep into the matched chain we are. Each rendered route component
// is wrapped one level deeper, so an <Outlet/> inside it renders the next match.
const MatchDepthContext = createContext(0);

export function RouterProvider(props: { router: Router }): FigNode {
  return createElement(
    RouterContext,
    { value: props.router },
    createElement(Outlet),
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

  if (isServerRoute(match.node.route)) {
    // A server (RSC) route renders nothing in the isomorphic tree: it leaves an
    // empty slot that the client mounts the streamed RSC payload into. (Its
    // component contains client references that cannot run under SSR.)
    return createElement("div", { [RSC_SLOT_ATTR]: match.routeId });
  }

  const Component = match.node.route.options.component;
  const child =
    Component === undefined
      ? createElement(Outlet)
      : createElement(Component, {});

  return createElement(MatchDepthContext, { value: depth + 1 }, child);
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
