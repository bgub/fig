import {
  createElement,
  type DataRefreshResult,
  dataResource,
  type DataResourceLoadContext,
  type ElementType,
  ErrorBoundary,
  type FigDataHydrationEntry,
  type FigDataStoreHandle,
  type FigNode,
  type Props,
  readData,
  readPromise,
  Suspense,
  useReactive,
  useSyncExternalStore,
} from "@bgub/fig";
import {
  decodePayloadDataEntries,
  decodePayloadValue,
  encodePayloadValue,
  isThenable,
  jsonPayloadCodec,
  type PayloadDataHydrationEntry,
  trackThenable,
} from "@bgub/fig/internal";
import {
  hydrateRoot,
  insertAssetResources,
  payloadDataLoader,
} from "@bgub/fig-dom";
import { ensureFigDevtoolsGlobalHook } from "@bgub/fig-devtools";
import {
  DEVTOOLS_PANE_ID,
  readDevtoolsOpenCookie,
  storeDevtoolsOpen,
} from "./devtools.ts";
import {
  createPayloadClientReferenceResolver,
  type PayloadClientReference,
  type ResolveClientReference,
} from "@bgub/fig/payload";
import {
  CLIENT_REFERENCE_MODULES_GLOBAL,
  DATA_ENDPOINT_PATH,
  DATA_FRAME_TRANSPORT,
  DATA_SCRIPT_ID,
  DEV_SERVER_UPDATE_EVENT,
  type DevServerUpdateMessage,
  PAYLOAD_FRAME_TRANSPORT,
  PAYLOAD_SEGMENTS_SCRIPT_ID,
  ROOT_ELEMENT_ID,
  ROUTER_STATE_SCRIPT_ID,
  type SerializedPayloadFrame,
  type SerializedPayloadSegment,
  type SerializedRouterState,
} from "./bootstrap.ts";
import {
  clientReferencePlaceholder,
  RouterProvider,
  ServerRouteContentProvider,
  type ServerRouteContentStore,
} from "./components.tsx";
import type { RouteMatch } from "./core.ts";
import { isServerRoute } from "./internal.ts";
import type { AnyRoute } from "./route.ts";
import { createRouter, type FigRouter, type RouterHistory } from "./router.ts";
import type { RouterLocation } from "./types.ts";
import {
  getPayloadFrameStream,
  type PayloadFrameStream,
} from "./payload-frames.ts";

interface ViteHotContext {
  on(
    event: typeof DEV_SERVER_UPDATE_EVENT,
    callback: (message: DevServerUpdateMessage) => void,
  ): void;
}

declare global {
  interface ImportMeta {
    readonly hot?: ViteHotContext;
  }
}

export interface StartClientOptions {
  container?: Element | null;
  context?: unknown;
  // Resolve a server route's client-reference ids back to components. With the
  // @bgub/fig-start/vite plugin, pass the generated manifest resolver.
  onRecoverableError?: (error: unknown) => void;
  resolveClientReference?: ResolveClientReference;
  routes: readonly AnyRoute[];
}

export function hydrateStart(options: StartClientOptions): FigRouter {
  const container =
    options.container ?? document.getElementById(ROOT_ELEMENT_ID);
  if (container === null) {
    throw new Error(`Missing #${ROOT_ELEMENT_ID} container to hydrate into.`);
  }

  // When the server rendered the DevTools panel, create the global hook BEFORE
  // hydrating the app so the app's first commit (and its element↔fiber
  // inspection) registers — otherwise Select mode and tree-hover highlighting
  // have no live data to resolve against.
  const devtoolsContainer = document.getElementById(DEVTOOLS_PANE_ID);
  if (devtoolsContainer !== null) ensureFigDevtoolsGlobalHook();

  // Prefetching the payload before the commit keeps the previous page
  // visible until the next server route can render. The closure reads
  // `serverRouteContent`, declared below (it needs the router); beforeCommit
  // only runs on navigations, long after both exist.
  const router = createRouter({
    beforeCommit: (location, result) =>
      result.status === "match"
        ? serverRouteContent.prepare(location, result.matches)
        : undefined,
    context: options.context,
    history: browserHistory(),
    routes: options.routes,
  });

  const state = readJson<SerializedRouterState>(ROUTER_STATE_SCRIPT_ID, {
    href: currentHref(),
    loaderData: {},
  });
  const initialData = decodePayloadDataEntries(
    readJson<PayloadDataHydrationEntry[]>(DATA_SCRIPT_ID, []),
  );

  router.hydrate(router.buildLocation(state.href), state.loaderData);

  const serverRouteContent = createServerRouteContent(options, router);

  // If the matched route was a `.server.tsx`, the document carries its payload
  // payload as streamed segment frames.
  const payloadSegments = readJson<SerializedPayloadSegment[]>(
    PAYLOAD_SEGMENTS_SCRIPT_ID,
    [],
  );
  if (payloadSegments.length > 0) {
    const stream = getPayloadStream();
    for (const segment of payloadSegments) {
      serverRouteContent.receiveSegment(
        segment,
        stream,
        payloadRouteUrl(router.getState().location),
      );
    }
  }

  const root = hydrateRoot(
    container,
    createElement(
      ServerRouteContentProvider,
      { store: serverRouteContent },
      createElement(RouterProvider, { router }),
    ),
    {
      initialData,
      onRecoverableError: options.onRecoverableError,
    },
  );
  serverRouteContent.bindRootData(root.data);
  subscribeDocumentDataFrames((entries) => root.data.hydrate(entries));

  installServerRouteFetcher(router, serverRouteContent);
  installDevServerUpdateHandler(serverRouteContent);
  installLinkInterceptor(router);
  installPopStateHandler(router);

  // hydrateRoot installed its capture listeners synchronously, so from here
  // every replayable event (clicks included) is queued and replayed even if
  // the shell has not committed yet. The attribute is the observable
  // "interactive" signal for tests and tooling — events that arrive before
  // this script runs are unrecoverable, so waiting on it is the only
  // race-free way to script a first interaction.
  container.setAttribute("data-fig-start-hydrated", "");

  if (devtoolsContainer !== null) void hydrateDevtoolsPanel(devtoolsContainer);

  return router;
}

// Hydrate the prerendered DevTools panel as its own root (devtools off, so it
// never inspects itself) and swap it to the live global hook — which already
// captured the app's first commit (ensured before hydration above). The panel
// UI is dynamic-imported so it stays out of the base client bundle.
async function hydrateDevtoolsPanel(container: HTMLElement): Promise<void> {
  const { hydrateDevtoolsPanel: hydrate } =
    await import("@bgub/fig-devtools/client");
  hydrate(container, ensureFigDevtoolsGlobalHook(), {
    defaultOpen: readDevtoolsOpenCookie(),
    onOpenChange: storeDevtoolsOpen,
    placement: "sidebar",
  });
}

type PayloadStream = PayloadFrameStream<SerializedPayloadFrame>;

// One wrapper covers every decoded client reference. Non-ssr references
// hydrate against the SSR placeholder template until the gate reveals; ssr
// references rendered real markup on the server and skip the gate. Identity
// across re-decodes is the stateful resolver's job: it calls this once per
// reference id and reuses the wrapper.
function createRouteClientReference(
  options: StartClientOptions,
  reference: PayloadClientReference,
  hydrationGate: ClientReferenceHydrationGate,
): ElementType {
  const resolution =
    resolvePreloadedClientReference(reference) ??
    options.resolveClientReference?.(reference);
  const resolved = isThenable(resolution) ? undefined : resolution;
  const pending = isThenable(resolution)
    ? Promise.resolve(resolution)
    : undefined;
  // A resolution that settles before its first render read (module loads are
  // awaited by prepare() ahead of the navigation commit) must read
  // synchronously, not suspend for a retry beat.
  if (pending !== undefined) trackThenable(pending);
  const ssr = reference.ssr === true;

  return function StartClientReference(
    props: Props & { children?: FigNode },
  ): FigNode {
    // Hook stability: `ssr` is constant per component instance, so each
    // instance always takes the same branch.
    if (!ssr) {
      const hydrated = useSyncExternalStore(
        (listener) => hydrationGate.subscribe(listener),
        () => hydrationGate.getSnapshot(),
        () => hydrationGate.getServerSnapshot(),
      );
      if (!hydrated) return clientReferencePlaceholder(reference.id);
    }

    if (resolved !== undefined) return createElement(resolved, props);
    if (pending !== undefined) {
      const type = clientReferenceType(readPromise(pending), reference.id);
      return createElement(type, props);
    }

    throw new Error(
      ssr
        ? `Client reference "${reference.id}" was server-rendered but was not preloaded before hydration.`
        : `Cannot render client reference "${reference.id}" without a client-reference resolver.`,
    );
  };
}

function resolvePreloadedClientReference(
  reference: PayloadClientReference,
): ElementType | undefined {
  const registry = (globalThis as Record<string, unknown>)[
    CLIENT_REFERENCE_MODULES_GLOBAL
  ];
  if (typeof registry !== "object" || registry === null) return undefined;

  const moduleValue = (registry as Record<string, unknown>)[reference.id];
  if (moduleValue === undefined) return undefined;
  if (
    typeof moduleValue === "object" &&
    moduleValue !== null &&
    reference.exportName !== undefined
  ) {
    return clientReferenceType(
      (moduleValue as Record<string, unknown>)[reference.exportName],
      reference.id,
    );
  }
  return clientReferenceType(moduleValue, reference.id);
}

function clientReferenceType(value: unknown, id: string): ElementType {
  if (typeof value === "function") return value as ElementType;
  throw new Error(`Client reference "${id}" did not resolve to a component.`);
}

interface ClientReferenceHydrationGate {
  getServerSnapshot(): boolean;
  getSnapshot(): boolean;
  reveal(): void;
  subscribe(listener: () => void): () => void;
}

function createClientReferenceHydrationGate(): ClientReferenceHydrationGate {
  let hydrated = false;
  const listeners = new Set<() => void>();

  return {
    getServerSnapshot: () => false,
    getSnapshot: () => hydrated,
    reveal() {
      if (hydrated) return;
      hydrated = true;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

interface ServerRouteContent extends ServerRouteContentStore {
  bindRootData(data: FigDataStoreHandle): void;
  prepare(
    location: RouterLocation,
    matches: readonly RouteMatch[],
  ): Promise<void>;
  receiveSegment(
    segment: SerializedPayloadSegment,
    stream: PayloadStream,
    url: string,
  ): void;
  refreshActiveRoute(): void;
  renderActiveRoute(): void;
}

interface InitialDocumentSegment {
  consumed: boolean;
  segment: SerializedPayloadSegment;
  stream: PayloadStream;
  url: string;
}

// Server routes are ordinary data resources: the key is [routeId, url], the
// loader is payloadDataLoader over the framework's payload response for that
// URL, and refresh/navigation use the existing freshness verbs. The initial
// document segment binds by serving the inline frame stream as the loader's
// Response, so pending holes keep filling after the shell flush through the
// same generation-guarded machinery a fetched payload uses.
function createServerRouteContent(
  options: StartClientOptions,
  router: FigRouter,
): ServerRouteContent {
  // Component identity per reference id: island state survives re-decodes
  // because the stateful resolver reuses one owned wrapper per reference,
  // gated or not (the initial segment decodes ungated; navigations gate).
  const clientReferenceResolver = createPayloadClientReferenceResolver(
    resolveRouteClientReference,
  );
  let rootData: FigDataStoreHandle | null = null;
  let initialSegment: InitialDocumentSegment | null = null;
  // The initial document's assets are already in the SSR head (hoisted at
  // render time), so its decode inserts/adopts them for dedupe but never
  // gates reveal on them — the markup on screen is already styled.
  let ungatedInitialAssets = false;
  const routeUrls = new Map<string, string>();
  const loadedKeys = new Set<string>();
  const pendingModuleLoads = new Set<PromiseLike<unknown>>();
  // Stylesheet gates from streamed assets: prepare() holds the navigation
  // commit until they settle, so a committed route never reveals unstyled or
  // blanks its slot while an island waits on CSS.
  const pendingAssetGates = new Set<PromiseLike<unknown>>();
  // One gate for the whole app: initial-segment islands render the SSR
  // placeholder template until the first hydration commit reveals them;
  // references decoded after that render immediately.
  const hydrationGate = createClientReferenceHydrationGate();

  const trackedOptions: StartClientOptions =
    options.resolveClientReference === undefined
      ? options
      : {
          ...options,
          resolveClientReference: (reference) => {
            const resolution = options.resolveClientReference?.(reference);
            if (!isThenable(resolution)) return resolution;
            const pending = Promise.resolve(resolution);
            pendingModuleLoads.add(pending);
            const remove = (): void => {
              pendingModuleLoads.delete(pending);
            };
            void pending.then(remove, remove);
            return pending;
          },
        };

  const reportedMissingResolvers = new Set<string>();

  // Called once per reference id: the stateful resolver wrapping this owns
  // identity and only consults it on a miss.
  function resolveRouteClientReference(
    reference: PayloadClientReference,
  ): ElementType {
    // A payload with client references but no resolver would render
    // placeholders forever; report loudly as soon as the reference row
    // decodes (the render-time throw still lands in the ErrorBoundary).
    if (
      options.resolveClientReference === undefined &&
      resolvePreloadedClientReference(reference) === undefined &&
      !reportedMissingResolvers.has(reference.id)
    ) {
      reportedMissingResolvers.add(reference.id);
      reportPayloadFetchError(
        reference.id,
        new Error(
          `Server route content renders client reference "${reference.id}", ` +
            `but hydrateStart() received no client-reference resolver. Pass ` +
            `resolveClientReference from "virtual:fig-start/client-manifest" ` +
            `(the @bgub/fig-start/vite plugin).`,
        ),
        options,
      );
    }

    return createRouteClientReference(trackedOptions, reference, hydrationGate);
  }

  const routeResource = dataResource<[string, string], FigNode>({
    key: (routeId, url) => ["fig-start", "server-route", routeId, url],
    load: payloadDataLoader<[string, string]>({
      prepareAssets: (streamed) => {
        const gate = insertAssetResources(streamed);
        if (ungatedInitialAssets) return undefined;
        pendingAssetGates.add(gate);
        const remove = (): void => {
          pendingAssetGates.delete(gate);
        };
        void gate.then(remove, remove);
        return gate;
      },
      request: (routeId, url, { signal }) => {
        // loadedKeys must not outlive the store entry it stands for: the
        // generation-lifetime signal aborts on supersession, hydrate-over,
        // eviction, and disposal, so unmarking here keeps the pre-commit
        // ensure honest — a post-eviction back navigation reloads before the
        // commit instead of committing into a suspended slot. A superseding
        // refresh transiently unmarks and re-marks on its own fulfillment.
        signal.addEventListener(
          "abort",
          () => loadedKeys.delete(loadedKey(routeId, url)),
          { once: true },
        );
        const initial = initialSegmentResponse(routeId, url);
        if (initial !== null) {
          ungatedInitialAssets = true;
          return initial;
        }
        // Navigations gate normally; if one overlaps the still-decoding
        // initial segment, late initial assets gate too (over-gating an
        // already-revealed document is harmless).
        ungatedInitialAssets = false;
        return fetch(url, {
          headers: { accept: jsonPayloadCodec.contentType },
          signal,
        });
      },
      resolveClientReference: clientReferenceResolver,
    }),
  });

  function RouteResourceReader(props: {
    routeId: string;
    url: string;
  }): FigNode {
    const node = readData(routeResource, props.routeId, props.url);
    // A passive effect on the content reader: it runs after the commit that
    // mounted (or hydrated) the decoded content, once island gate
    // subscriptions are attached — so hydration first matches the SSR
    // placeholder templates, then every island reveals exactly once.
    useReactive(() => {
      hydrationGate.reveal();
      return undefined;
    }, []);
    return node;
  }

  function initialSegmentResponse(
    routeId: string,
    url: string,
  ): Response | null {
    const initial = initialSegment;
    if (
      initial === null ||
      initial.consumed ||
      initial.segment.routeId !== routeId ||
      initial.url !== url
    ) {
      return null;
    }
    initial.consumed = true;

    const encoder = new TextEncoder();
    let unsubscribe: () => void = () => undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        unsubscribe = initial.stream.s((frame) => {
          if (frame.id !== initial.segment.id) return;
          if (frame.end === true) {
            unsubscribe();
            controller.close();
            return;
          }
          if (frame.chunk.length > 0) {
            controller.enqueue(encoder.encode(frame.chunk));
          }
        });
      },
      cancel() {
        unsubscribe();
      },
    });
    return new Response(stream);
  }

  function loadedKey(routeId: string, url: string): string {
    return `${routeId}\n${url}`;
  }

  function settleRouteLoad(
    routeId: string,
    url: string,
  ): (result: DataRefreshResult<FigNode>) => void {
    return (result) => {
      if (result.status === "fulfilled") {
        loadedKeys.add(loadedKey(routeId, url));
      } else if (result.status === "rejected") {
        reportPayloadFetchError(routeId, result.error, options);
      }
    };
  }

  // Ensure-loaded, not force-refresh: a cached key (back/forward navigation)
  // resolves immediately; a new key loads and settles before the commit.
  function ensureRouteLoaded(
    routeId: string,
    url: string,
  ): Promise<void> | undefined {
    if (loadedKeys.has(loadedKey(routeId, url)) || rootData === null) {
      return undefined;
    }
    return rootData
      .refreshData(routeResource, routeId, url)
      .then(settleRouteLoad(routeId, url));
  }

  // The idle-router preamble shared by refresh/render of the active route:
  // resolves the current server-route match and records its URL.
  function activeServerRoute(): { routeId: string; url: string } | null {
    const state = router.getState();
    if (state.status !== "idle") return null;
    const match = firstServerRouteMatch(state.matches);
    if (match === undefined) return null;
    const url = payloadRouteUrl(state.location);
    routeUrls.set(match.routeId, url);
    return { routeId: match.routeId, url };
  }

  return {
    bindRootData(data) {
      rootData = data;
    },
    receiveSegment(segment, stream, url) {
      routeUrls.set(segment.routeId, url);
      initialSegment = { consumed: false, segment, stream, url };
    },
    // Pre-commit gate for navigations: the incoming route's payload settles
    // (and its island modules finish — loads began at reference-row arrival)
    // before the router commits, so the previous page stays visible until the
    // next server route can render.
    async prepare(location, matches) {
      const match = firstServerRouteMatch(matches);
      if (match === undefined) return;
      const url = payloadRouteUrl(location);
      routeUrls.set(match.routeId, url);
      await ensureRouteLoaded(match.routeId, url);
      await Promise.allSettled([...pendingModuleLoads, ...pendingAssetGates]);
      // Navigations commit post-hydration content: reveal the placeholder
      // gate so islands mount real components inside the route-swap commit
      // instead of paying a placeholder → reveal follow-up commit. On a
      // fresh client-route document the gate has never revealed, and the
      // route swap is the wrong place to start placeholder-matching.
      hydrationGate.reveal();
    },
    render(routeId) {
      const url = routeUrls.get(routeId);
      if (url === undefined) return null;
      return serverRouteNode(
        createElement(RouteResourceReader, { routeId, url }),
      );
    },
    refreshActiveRoute() {
      const active = activeServerRoute();
      if (active === null || rootData === null) return;
      void rootData
        .refreshData(routeResource, active.routeId, active.url)
        .then(settleRouteLoad(active.routeId, active.url));
    },
    renderActiveRoute() {
      const active = activeServerRoute();
      if (active === null) return;
      void ensureRouteLoaded(active.routeId, active.url);
    },
  };
}

function serverRouteNode(node: FigNode): FigNode {
  return createElement(
    ErrorBoundary,
    { fallback: createElement("div", { "data-fig-payload-error": "" }) },
    createElement(Suspense, { fallback: null }, node),
  );
}

function installServerRouteFetcher(
  router: FigRouter,
  content: ServerRouteContent,
): void {
  let scheduled = false;

  router.subscribe(() => {
    if (router.getState().status !== "idle" || scheduled) return;

    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      content.renderActiveRoute();
    });
  });
}

function installDevServerUpdateHandler(content: ServerRouteContent): void {
  const hot = import.meta.hot;
  if (hot === undefined) return;

  let queued = false;
  let running = false;

  hot.on(DEV_SERVER_UPDATE_EVENT, () => {
    queued = true;
    if (running) return;
    running = true;
    runQueuedDevServerUpdates();
  });

  function runQueuedDevServerUpdates(): void {
    try {
      while (queued) {
        queued = false;
        content.refreshActiveRoute();
      }
    } finally {
      running = false;
      if (queued) {
        running = true;
        runQueuedDevServerUpdates();
      }
    }
  }
}

function firstServerRouteMatch(
  matches: readonly RouteMatch[],
): RouteMatch | undefined {
  return matches.find((match) => isServerRoute(match.node.route));
}

function payloadRouteUrl(location: RouterLocation): string {
  return location.pathname + location.search;
}

// Loader factory the Fig Start transform bakes into browser stubs of
// remoteDataResource declarations: the returned loader closes over the
// generated resource id, so the store treats the stub as an ordinary
// loader-backed resource whose loader calls the framework data endpoint.
export function remoteDataLoader(
  id: string,
): (
  ...argsAndContext: [...unknown[], DataResourceLoadContext]
) => Promise<unknown> {
  return (...argsAndContext) => {
    const context = argsAndContext[
      argsAndContext.length - 1
    ] as DataResourceLoadContext;
    return fetchRemoteData(id, argsAndContext.slice(0, -1), context.signal);
  };
}

async function fetchRemoteData(
  id: string,
  args: readonly unknown[],
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetch(DATA_ENDPOINT_PATH, {
    body: JSON.stringify({
      args: args.map((arg) => encodePayloadValue(arg)),
      id,
    }),
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    method: "POST",
    signal,
  });
  if (!response.ok) {
    throw new Error(
      `Data resource request failed with status ${response.status}.`,
    );
  }

  const body = (await response.json()) as {
    value?: PayloadDataHydrationEntry["value"];
  };
  return body.value === undefined ? undefined : decodePayloadValue(body.value);
}

function reportPayloadFetchError(
  routeId: string,
  error: unknown,
  options: StartClientOptions,
): void {
  if (options.onRecoverableError !== undefined) {
    options.onRecoverableError(error);
    return;
  }
  console.error(
    `[fig-start] server route "${routeId}" payload fetch failed:`,
    error,
  );
}

// The shared transport getter reads-or-installs the queue global and replays
// document frames the queue missed (a bundle that executed mid-stream or
// without the bootstrap).
function getPayloadStream(): PayloadStream {
  return getPayloadFrameStream<SerializedPayloadFrame>(PAYLOAD_FRAME_TRANSPORT);
}

// The document data stream is the same generic frame transport under its own
// global; each frame carries one encoded entry batch. Replay/dedupe of
// document frames is the transport's job — entries themselves need no second
// dedupe because the server sends each key at most once per document.
function subscribeDocumentDataFrames(
  onEntries: (entries: FigDataHydrationEntry[]) => void,
): void {
  getPayloadFrameStream<PayloadDataHydrationEntry[]>(DATA_FRAME_TRANSPORT).s(
    (frame) => {
      const entries = decodePayloadDataEntries(frame);
      if (entries.length > 0) onEntries(entries);
    },
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
    void router.sync(router.buildLocation(currentHref()));
  });
}

function readJson<T>(id: string, fallback: T): T {
  const element = document.getElementById(id);
  if (element === null) return fallback;
  const text = element.textContent;
  if (text === null || text.length === 0) return fallback;
  return JSON.parse(text) as T;
}
