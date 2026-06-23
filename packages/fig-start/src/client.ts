import {
  createElement,
  type ElementType,
  ErrorBoundary,
  Suspense,
} from "@bgub/fig";
import type { FigDataHydrationEntry } from "@bgub/fig/internal";
import { createRoot, hydrateRoot } from "@bgub/fig-dom";
import { createRscResponse } from "@bgub/fig-server/rsc";
import {
  DATA_SCRIPT_ID,
  hasClientReferences,
  ROOT_ELEMENT_ID,
  RSC_PAYLOAD_SCRIPT_ID,
  RSC_SLOT_ATTR,
  ROUTER_STATE_SCRIPT_ID,
  type SerializedRouterState,
  type SerializedRscPayload,
} from "./bootstrap.ts";
import { RouterProvider } from "./components.tsx";
import type { Router } from "./core.ts";
import { createRouter, type FigRouter, type RouterHistory } from "./router.ts";
import type { AnyRoute } from "./route.ts";

export interface StartClientOptions {
  container?: Element | null;
  context?: unknown;
  // Resolve a server route's client-reference ids back to components. With the
  // @bgub/fig-start/vite plugin, pass the generated manifest's loadClientReference.
  loadClientReference?: (metadata: { id: string }) => Promise<unknown>;
  onRecoverableError?: (error: unknown) => void;
  resolveClientReference?: (metadata: { id: string }) => ElementType;
  routes: readonly AnyRoute[];
}

export function hydrateStart(options: StartClientOptions): FigRouter {
  const container =
    options.container ?? document.getElementById(ROOT_ELEMENT_ID);
  if (container === null) {
    throw new Error(`Missing #${ROOT_ELEMENT_ID} container to hydrate into.`);
  }

  const router = createRouter({
    context: options.context,
    history: browserHistory(),
    routes: options.routes,
  });

  const state = readJson<SerializedRouterState>(ROUTER_STATE_SCRIPT_ID, {
    href: currentHref(),
    loaderData: {},
  });
  const initialData = readJson<FigDataHydrationEntry[]>(DATA_SCRIPT_ID, []);

  router.hydrate(router.buildLocation(state.href), state.loaderData);

  hydrateRoot(container, createElement(RouterProvider, { router }), {
    initialData,
    onRecoverableError: options.onRecoverableError,
  });

  // If the matched route was a `.server.tsx`, the document carries its RSC
  // payload; mount it into the slot the SSR'd layout left behind.
  const rscPayload = readJson<SerializedRscPayload | null>(
    RSC_PAYLOAD_SCRIPT_ID,
    null,
  );
  if (rscPayload !== null) {
    mountServerRoute(container, rscPayload, options, router);
  }

  installLinkInterceptor(router);
  installPopStateHandler(router);

  return router;
}

function mountServerRoute(
  container: Element,
  payload: SerializedRscPayload,
  options: StartClientOptions,
  router: FigRouter,
): void {
  const slot = findSlot(container, payload.routeId);
  if (slot === null) return;

  requireClientReferenceResolver(payload, options);

  const response = createRscResponse({
    loadClientReference: options.loadClientReference,
    resolveClientReference: options.resolveClientReference,
  });
  response.processStringChunk(payload.rows);

  // The RSC tree renders in its own root nested in the slot. Client references
  // suspend while their chunks load (Suspense); a render/decode error surfaces
  // via the boundary instead of escaping as a detached uncaught error.
  const root = createRoot(slot, {
    onRecoverableError: options.onRecoverableError,
    onUncaughtError: (error) => {
      console.error(
        `[fig-start] server route "${payload.routeId}" render error:`,
        error,
      );
    },
  });
  const render = (): void => {
    root.render(
      createElement(
        ErrorBoundary,
        { fallback: createElement("div", { "data-fig-rsc-error": "" }) },
        createElement(Suspense, { fallback: null }, response.getRoot()),
      ),
    );
  };
  const unsubscribeResponse = response.subscribe(render);
  render();

  // Tear the nested root down when the user navigates away from the server
  // route, so the root, its data store, and the response listener don't leak.
  watchServerRouteLifetime(router, payload.routeId, () => {
    unsubscribeResponse();
    root.unmount();
  });
}

// Exported for testing: the missing-resolver guard and the navigation-teardown
// watcher are pure logic, so they're verified without a DOM.
export function requireClientReferenceResolver(
  payload: SerializedRscPayload,
  options: Pick<
    StartClientOptions,
    "loadClientReference" | "resolveClientReference"
  >,
): void {
  if (
    options.loadClientReference === undefined &&
    options.resolveClientReference === undefined &&
    hasClientReferences(payload.rows)
  ) {
    throw new Error(
      `Server route "${payload.routeId}" renders client components, but ` +
        `hydrateStart() received no client-reference resolver. Pass ` +
        `loadClientReference from "virtual:fig-start/client-manifest" (the ` +
        `@bgub/fig-start/vite plugin).`,
    );
  }
}

export function watchServerRouteLifetime(
  router: Pick<Router, "getState" | "subscribe">,
  routeId: string,
  dispose: () => void,
): void {
  const unsubscribe = router.subscribe(() => {
    if (router.getState().matches.some((match) => match.routeId === routeId)) {
      return;
    }
    unsubscribe();
    dispose();
  });
}

function findSlot(container: Element, routeId: string): Element | null {
  const escaped =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(routeId)
      : routeId;
  return container.querySelector(`[${RSC_SLOT_ATTR}="${escaped}"]`);
}

function browserHistory(): RouterHistory {
  return {
    push: (href) => window.history.pushState(null, "", href),
    replace: (href) => window.history.replaceState(null, "", href),
  };
}

function currentHref(): string {
  return (
    window.location.pathname + window.location.search + window.location.hash
  );
}

function installLinkInterceptor(router: FigRouter): void {
  document.addEventListener("click", (event) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest("a[data-fig-link]");
    if (anchor === null) return;

    const href = anchor.getAttribute("href");
    if (href === null) return;
    const anchorTarget = anchor.getAttribute("target");
    if (anchorTarget !== null && anchorTarget !== "_self") return;

    const url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin) return;

    event.preventDefault();
    void router.navigate({
      replace: anchor.getAttribute("data-fig-link") === "replace",
      to: url.pathname + url.search + url.hash,
    });
  });
}

function installPopStateHandler(router: FigRouter): void {
  window.addEventListener("popstate", () => {
    const location = router.buildLocation(currentHref());
    void (async () => {
      const result = await router.load(location);
      if (result.status === "redirect") {
        await router.navigate({ replace: true, to: result.redirect.to });
        return;
      }
      // The browser already updated the URL, so commit without pushing.
      router.commit(location, result);
    })();
  });
}

function readJson<T>(id: string, fallback: T): T {
  const element = document.getElementById(id);
  if (element === null) return fallback;
  const text = element.textContent;
  if (text === null || text.length === 0) return fallback;
  return JSON.parse(text) as T;
}
