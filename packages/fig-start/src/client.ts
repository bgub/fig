import {
  createElement,
  type ElementType,
  ErrorBoundary,
  Suspense,
} from "@bgub/fig";
import type { FigDataHydrationEntry } from "@bgub/fig/internal";
import { createRoot, hydrateRoot } from "@bgub/fig-dom";
import {
  createRscResponse,
  fetchRsc,
  isRscRequestCancelled,
} from "@bgub/fig-server/rsc";
import {
  DATA_SCRIPT_ID,
  hasClientReferences,
  ROOT_ELEMENT_ID,
  RSC_FRAME_ATTR,
  RSC_PAYLOAD_SCRIPT_ID,
  RSC_SEGMENTS_SCRIPT_ID,
  RSC_SLOT_ATTR,
  RSC_STREAM_GLOBAL,
  ROUTER_STATE_SCRIPT_ID,
  type SerializedRscFrame,
  type SerializedRouterState,
  type SerializedRscPayload,
  type SerializedRscSegment,
} from "./bootstrap.ts";
import { RouterProvider } from "./components.tsx";
import type { Router } from "./core.ts";
import { createRouter, type FigRouter, type RouterHistory } from "./router.ts";
import type { AnyRoute } from "./route.ts";
import type { RouterLocation } from "./types.ts";

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

  const serverRouteMounts = createServerRouteMounts(options, router);

  // If the matched route was a `.server.tsx`, the document carries its RSC
  // payload; mount it into the slot the SSR'd layout left behind. Newer payloads
  // arrive as streamed segment frames; keep the old buffered script as a fallback
  // so tests/apps using older server output still hydrate.
  const rscSegments = readJson<SerializedRscSegment[]>(
    RSC_SEGMENTS_SCRIPT_ID,
    [],
  );
  if (rscSegments.length > 0) {
    const stream = getRscStream();
    for (const segment of rscSegments) {
      mountServerRouteSegment(
        container,
        segment,
        stream,
        options,
        serverRouteMounts,
      );
    }
  }

  const legacyRscPayload = readJson<SerializedRscPayload | null>(
    RSC_PAYLOAD_SCRIPT_ID,
    null,
  );
  if (legacyRscPayload !== null) {
    mountBufferedServerRoute(
      container,
      legacyRscPayload,
      options,
      serverRouteMounts,
    );
  }

  installServerRouteFetcher(container, options, router, serverRouteMounts);
  installLinkInterceptor(router);
  installPopStateHandler(router);

  return router;
}

interface RscStream {
  p(frame: SerializedRscFrame): void;
  q: SerializedRscFrame[];
  s(listener: (frame: SerializedRscFrame) => void): () => void;
}

function mountServerRouteSegment(
  container: Element,
  segment: SerializedRscSegment,
  stream: RscStream,
  options: StartClientOptions,
  mounts: ServerRouteMounts,
): void {
  const slot = findSlot(container, segment.routeId);
  if (slot === null) return;

  const response = createServerRouteResponse(options);
  const processFrame = (frame: SerializedRscFrame): void => {
    if (frame.id !== segment.id) return;
    requireClientReferenceResolverForRows(
      segment.routeId,
      frame.chunk,
      options,
    );
    response.processStringChunk(frame.chunk);
  };
  const unsubscribeStream = stream.s(processFrame);

  mounts.mount(slot, segment.routeId, response, unsubscribeStream);
}

function mountBufferedServerRoute(
  container: Element,
  payload: SerializedRscPayload,
  options: StartClientOptions,
  mounts: ServerRouteMounts,
): void {
  const slot = findSlot(container, payload.routeId);
  if (slot === null) return;

  requireClientReferenceResolverForRows(payload.routeId, payload.rows, options);
  const response = createServerRouteResponse(options);
  response.processStringChunk(payload.rows);

  mounts.mount(slot, payload.routeId, response);
}

function createServerRouteResponse(
  options: StartClientOptions,
): ReturnType<typeof createRscResponse> {
  return createRscResponse({
    loadClientReference: options.loadClientReference,
    resolveClientReference: options.resolveClientReference,
  });
}

interface ServerRouteMounts {
  has(routeId: string): boolean;
  mount(
    slot: Element,
    routeId: string,
    response: ReturnType<typeof createRscResponse>,
    dispose?: () => void,
  ): void;
}

function createServerRouteMounts(
  options: StartClientOptions,
  router: FigRouter,
): ServerRouteMounts {
  const mountedRoutes = new Set<string>();

  return {
    has: (routeId) => mountedRoutes.has(routeId),
    mount(slot, routeId, response, dispose = () => undefined) {
      if (mountedRoutes.has(routeId)) {
        dispose();
        return;
      }

      const root = createServerRouteRoot(slot, routeId, response, options);
      const unsubscribeResponse = response.subscribe(root.render);
      mountedRoutes.add(routeId);
      root.render();

      watchServerRouteLifetime(router, routeId, () => {
        mountedRoutes.delete(routeId);
        dispose();
        unsubscribeResponse();
        root.unmount();
      });
    },
  };
}

function createServerRouteRoot(
  slot: Element,
  routeId: string,
  response: ReturnType<typeof createRscResponse>,
  options: StartClientOptions,
): { render: () => void; unmount: () => void } {
  // The RSC tree renders in its own root nested in the slot. Client references
  // suspend while their chunks load (Suspense); a render/decode error surfaces
  // via the boundary instead of escaping as a detached uncaught error.
  const root = createRoot(slot, {
    onRecoverableError: options.onRecoverableError,
    onUncaughtError: (error) => {
      console.error(
        `[fig-start] server route "${routeId}" render error:`,
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
  return { render, unmount: () => root.unmount() };
}

function installServerRouteFetcher(
  container: Element,
  options: StartClientOptions,
  router: FigRouter,
  mounts: ServerRouteMounts,
): void {
  let scheduled = false;

  router.subscribe(() => {
    if (router.getState().status !== "idle" || scheduled) return;

    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      mountActiveServerRouteSegments(container, options, router, mounts);
    });
  });
}

function mountActiveServerRouteSegments(
  container: Element,
  options: StartClientOptions,
  router: FigRouter,
  mounts: ServerRouteMounts,
): void {
  const state = router.getState();
  if (state.status !== "idle") return;
  let retryMissingSlot = false;

  for (const match of state.matches) {
    if (match.node.route.options.server !== true) continue;
    if (mounts.has(match.routeId)) continue;

    const slot = findSlot(container, match.routeId);
    if (slot === null) {
      retryMissingSlot = true;
      continue;
    }

    const response = createServerRouteResponse(options);
    const controller = new AbortController();
    mounts.mount(slot, match.routeId, response, () => controller.abort());

    void fetchServerRouteRsc(
      response,
      match.routeId,
      rscRouteUrl(state.location),
      options,
      controller.signal,
    ).catch((error: unknown) => {
      if (isRscRequestCancelled(error)) return;
      reportRscFetchError(match.routeId, error, options);
    });
  }

  if (retryMissingSlot) {
    setTimeout(() => {
      mountActiveServerRouteSegments(container, options, router, mounts);
    }, 0);
  }
}

function fetchServerRouteRsc(
  response: ReturnType<typeof createRscResponse>,
  routeId: string,
  url: string,
  options: StartClientOptions,
  signal: AbortSignal,
): Promise<Response> {
  return fetchRsc(response, url, {
    fetch: async (input, init) => {
      const result = await fetch(input, init);
      if (result.body === null || hasClientReferenceResolver(options)) {
        return result;
      }
      return new Response(guardRscRows(routeId, result.body, options), {
        headers: result.headers,
        status: result.status,
        statusText: result.statusText,
      });
    },
    signal,
  });
}

function guardRscRows(
  routeId: string,
  stream: ReadableStream<Uint8Array>,
  options: StartClientOptions,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let bufferedRows = "";
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      reader = stream.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        const chunk =
          done && value === undefined
            ? decoder.decode()
            : decoder.decode(value, { stream: !done });

        if (chunk.length > 0 || done) {
          requireClientReferenceResolverForCompleteRows(routeId, chunk, done);
        }
        if (value !== undefined) controller.enqueue(value);

        if (done) {
          controller.close();
          return;
        }
      }
    },
    cancel(reason) {
      void reader?.cancel(reason).catch(() => undefined);
    },
  });

  function requireClientReferenceResolverForCompleteRows(
    routeId: string,
    chunk: string,
    done: boolean,
  ): void {
    bufferedRows += chunk;
    const rows = bufferedRows.split("\n");
    bufferedRows = rows.pop() ?? "";

    for (const row of rows) {
      requireClientReferenceResolverForRows(routeId, row, options);
    }
    if (done) {
      requireClientReferenceResolverForRows(routeId, bufferedRows, options);
      bufferedRows = "";
    }
  }
}

function hasClientReferenceResolver(
  options: Pick<
    StartClientOptions,
    "loadClientReference" | "resolveClientReference"
  >,
): boolean {
  return (
    options.loadClientReference !== undefined ||
    options.resolveClientReference !== undefined
  );
}

function rscRouteUrl(location: RouterLocation): string {
  return location.pathname + location.search;
}

function reportRscFetchError(
  routeId: string,
  error: unknown,
  options: StartClientOptions,
): void {
  if (options.onRecoverableError !== undefined) {
    options.onRecoverableError(error);
    return;
  }
  console.error(
    `[fig-start] server route "${routeId}" RSC fetch failed:`,
    error,
  );
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
  requireClientReferenceResolverForRows(payload.routeId, payload.rows, options);
}

function requireClientReferenceResolverForRows(
  routeId: string,
  rows: string,
  options: Pick<
    StartClientOptions,
    "loadClientReference" | "resolveClientReference"
  >,
): void {
  if (!hasClientReferenceResolver(options) && hasClientReferences(rows)) {
    throw new Error(
      `Server route "${routeId}" renders client components, but ` +
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

function readRscStream(): RscStream | null {
  const value = (globalThis as Record<string, unknown>)[RSC_STREAM_GLOBAL];
  return isRscStream(value) ? value : null;
}

function getRscStream(): RscStream {
  const current = readRscStream();
  if (current !== null) return current;

  const stream = createRscStream(readRscFramesFromDocument());
  (globalThis as Record<string, unknown>)[RSC_STREAM_GLOBAL] = stream;
  return stream;
}

function createRscStream(
  initialFrames: readonly SerializedRscFrame[],
): RscStream {
  let listeners: Array<(frame: SerializedRscFrame) => void> = [];
  const stream: RscStream = {
    q: [...initialFrames],
    p(frame) {
      stream.q.push(frame);
      for (const listener of listeners) listener(frame);
    },
    s(listener) {
      listeners.push(listener);
      for (const frame of stream.q) listener(frame);
      return () => {
        listeners = listeners.filter((item) => item !== listener);
      };
    },
  };
  return stream;
}

function isRscStream(value: unknown): value is RscStream {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { q?: unknown }).q) &&
    typeof (value as { p?: unknown }).p === "function" &&
    typeof (value as { s?: unknown }).s === "function"
  );
}

function readRscFramesFromDocument(): SerializedRscFrame[] {
  return Array.from(
    document.querySelectorAll(`script[${RSC_FRAME_ATTR}]`),
    (element) => JSON.parse(element.textContent ?? "") as SerializedRscFrame,
  );
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
