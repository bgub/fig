import {
  createElement,
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
  decodePayloadDataEntries,
  decodePayloadValue,
  encodePayloadValue,
  jsonPayloadCodec,
  type PayloadClientReferenceMetadata,
  type PayloadDataHydrationEntry,
} from "@bgub/fig/payload";
import {
  getPayloadFrameStream,
  type PayloadFrameStream,
} from "@bgub/fig-server/payload";
import {
  CLIENT_REFERENCE_MODULES_GLOBAL,
  DATA_ENDPOINT_PATH,
  DATA_FRAME_ATTR,
  DATA_SCRIPT_ID,
  DATA_STREAM_GLOBAL,
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
  RouterProvider,
  ServerRouteContentProvider,
  type ServerRouteContentStore,
} from "./components.tsx";
import type { RouteMatch } from "./core.ts";
import { isServerRoute } from "./internal.ts";
import type { AnyRoute } from "./route.ts";
import { createRouter, type FigRouter, type RouterHistory } from "./router.ts";
import type { RouterLocation } from "./types.ts";

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
  // @bgub/fig-start/vite plugin, pass the generated manifest's loadClientReference.
  loadClientReference?: (
    metadata: PayloadClientReferenceMetadata,
  ) => Promise<unknown>;
  onRecoverableError?: (error: unknown) => void;
  resolveClientReference?: (
    metadata: PayloadClientReferenceMetadata,
  ) => ElementType | undefined;
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

  const serverRouteContent = createServerRouteContent(
    options,
    router,
    createClientReferenceTypeCache(),
  );

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
  getDataStream().s((entries) => root.data.hydrate(entries));

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

interface DataStream {
  decoded?: true;
  p(entries: readonly PayloadDataHydrationEntry[]): void;
  q: FigDataHydrationEntry[];
  s(listener: (entries: readonly FigDataHydrationEntry[]) => void): () => void;
}

function createHydratableClientReference(
  options: StartClientOptions,
  metadata: PayloadClientReferenceMetadata,
  clientReferenceTypes: ClientReferenceTypeCache,
  hydrationGate: ClientReferenceHydrationGate,
): ElementType {
  if (metadata.ssr === true) {
    return requireStableClientReference(
      options,
      metadata,
      clientReferenceTypes,
    );
  }

  const resolved =
    resolvePreloadedClientReference(metadata) ??
    options.resolveClientReference?.(metadata);
  const loaded =
    resolved === undefined
      ? options.loadClientReference?.(metadata)
      : undefined;

  return function StartHydratableClientReference(
    props: Props & { children?: FigNode },
  ): FigNode {
    const hydrated = useSyncExternalStore(
      (listener) => hydrationGate.subscribe(listener),
      () => hydrationGate.getSnapshot(),
      () => hydrationGate.getServerSnapshot(),
    );
    if (!hydrated) return clientReferencePlaceholder(metadata);

    if (resolved !== undefined) return createElement(resolved, props);
    if (loaded !== undefined) {
      const type = resolveClientReferenceExport(
        readPromise(loaded),
        metadata.id,
      );
      return createElement(type, props);
    }

    throw new Error(
      `Cannot render client reference "${metadata.id}" without a client-reference resolver.`,
    );
  };
}

interface ClientReferenceTypeCache {
  types: Map<string, ElementType>;
}

function createClientReferenceTypeCache(): ClientReferenceTypeCache {
  return { types: new Map() };
}

function resolveStableClientReference(
  options: StartClientOptions,
  metadata: PayloadClientReferenceMetadata,
  clientReferenceTypes: ClientReferenceTypeCache,
): ElementType | undefined {
  const cached = clientReferenceTypes.types.get(metadata.id);
  if (cached !== undefined) return cached;

  const resolved =
    resolvePreloadedClientReference(metadata) ??
    options.resolveClientReference?.(metadata);
  const loaded =
    resolved === undefined
      ? options.loadClientReference?.(metadata)
      : undefined;

  if (resolved !== undefined) {
    const type = function StartStableResolvedClientReference(
      props: Props & { children?: FigNode },
    ): FigNode {
      return createElement(resolved, props);
    };
    clientReferenceTypes.types.set(metadata.id, type);
    return type;
  }

  if (loaded === undefined) return undefined;

  const type = function StartStableLoadedClientReference(
    props: Props & { children?: FigNode },
  ): FigNode {
    const loadedType = resolveClientReferenceExport(
      readPromise(loaded),
      metadata.id,
    );
    return createElement(loadedType, props);
  };
  clientReferenceTypes.types.set(metadata.id, type);
  return type;
}

function requireStableClientReference(
  options: StartClientOptions,
  metadata: PayloadClientReferenceMetadata,
  clientReferenceTypes: ClientReferenceTypeCache,
): ElementType {
  return (
    resolveStableClientReference(options, metadata, clientReferenceTypes) ??
    function MissingStableClientReference(): FigNode {
      throw new Error(
        `Client reference "${metadata.id}" was server-rendered but was not preloaded before hydration.`,
      );
    }
  );
}

function clientReferencePlaceholder(metadata: { id: string }): FigNode {
  return createElement("template", {
    "data-fig-client-reference": metadata.id,
  });
}

function resolvePreloadedClientReference(
  metadata: PayloadClientReferenceMetadata,
): ElementType | undefined {
  const registry = (globalThis as Record<string, unknown>)[
    CLIENT_REFERENCE_MODULES_GLOBAL
  ];
  if (typeof registry !== "object" || registry === null) return undefined;

  const moduleValue = (registry as Record<string, unknown>)[metadata.id];
  if (moduleValue === undefined) return undefined;
  return resolveClientReferenceExport(moduleValue, metadata.id);
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

function resolveClientReferenceExport(
  moduleValue: unknown,
  id: string,
): ElementType {
  if (typeof moduleValue === "function") return moduleValue as ElementType;

  if (typeof moduleValue === "object" && moduleValue !== null) {
    const exportName = id.includes("#")
      ? id.slice(id.lastIndexOf("#") + 1)
      : "";
    const candidate =
      exportName === ""
        ? undefined
        : (moduleValue as Record<string, unknown>)[exportName];
    if (typeof candidate === "function") return candidate as ElementType;
  }

  throw new Error(`Client reference "${id}" did not resolve to a component.`);
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
  clientReferenceTypes: ClientReferenceTypeCache,
): ServerRouteContent {
  let rootData: FigDataStoreHandle | null = null;
  let initialSegment: InitialDocumentSegment | null = null;
  // The initial document's assets are already in the SSR head (hoisted at
  // render time), so its decode inserts/adopts them for dedupe but never
  // gates reveal on them — the markup on screen is already styled.
  let ungatedInitialAssets = false;
  const routeUrls = new Map<string, string>();
  const versions = new Map<string, number>();
  const routeListeners = new Map<string, Set<() => void>>();
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
    options.loadClientReference === undefined
      ? options
      : {
          ...options,
          loadClientReference: (metadata) => {
            const load = options.loadClientReference?.(metadata);
            if (load === undefined) {
              throw new Error(
                `Client reference "${metadata.id}" has no loader.`,
              );
            }
            pendingModuleLoads.add(load);
            const remove = (): void => {
              pendingModuleLoads.delete(load);
            };
            void load.then(remove, remove);
            return load;
          },
        };

  // Component identity is cached per reference id so island state survives
  // re-decodes: a refreshed tree reuses the same component function, and the
  // reconciler updates in place.
  const reportedMissingResolvers = new Set<string>();

  function resolveRouteClientReference(
    metadata: PayloadClientReferenceMetadata,
  ): ElementType {
    const cached = clientReferenceTypes.types.get(metadata.id);
    if (cached !== undefined) return cached;

    // A payload with client references but no resolver would render
    // placeholders forever; report loudly as soon as the reference row
    // decodes (the render-time throw still lands in the ErrorBoundary).
    if (
      options.loadClientReference === undefined &&
      options.resolveClientReference === undefined &&
      resolvePreloadedClientReference(metadata) === undefined &&
      !reportedMissingResolvers.has(metadata.id)
    ) {
      reportedMissingResolvers.add(metadata.id);
      reportPayloadFetchError(
        metadata.id,
        new Error(
          `Server route content renders client reference "${metadata.id}", ` +
            `but hydrateStart() received no client-reference resolver. Pass ` +
            `loadClientReference from "virtual:fig-start/client-manifest" ` +
            `(the @bgub/fig-start/vite plugin).`,
        ),
        options,
      );
    }

    const type = createHydratableClientReference(
      trackedOptions,
      metadata,
      clientReferenceTypes,
      hydrationGate,
    );
    clientReferenceTypes.types.set(metadata.id, type);
    return type;
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
      resolveClientReference: resolveRouteClientReference,
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

  function bumpVersion(routeId: string): void {
    versions.set(routeId, (versions.get(routeId) ?? 0) + 1);
    for (const listener of routeListeners.get(routeId) ?? []) listener();
  }

  function loadedKey(routeId: string, url: string): string {
    return `${routeId}\n${url}`;
  }

  // Ensure-loaded, not force-refresh: a cached key (back/forward navigation)
  // resolves immediately; a new key loads and settles before the commit.
  function ensureRouteLoaded(
    routeId: string,
    url: string,
  ): Promise<void> | undefined {
    const key = loadedKey(routeId, url);
    if (loadedKeys.has(key) || rootData === null) return undefined;
    return rootData.refreshData(routeResource, routeId, url).then((result) => {
      if (result.status === "fulfilled") loadedKeys.add(key);
      else if (result.status === "rejected") {
        reportPayloadFetchError(routeId, result.error, options);
      }
    });
  }

  return {
    bindRootData(data) {
      rootData = data;
    },
    // Reveal happens from the content reader's layout effect (below), which
    // commits together with the islands whose gate subscriptions it flips —
    // this commit callback fires on shell commits too, before any island has
    // subscribed, so revealing here would be lost.
    commit() {},
    getSnapshot(routeId) {
      return versions.get(routeId) ?? 0;
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
      bumpVersion(match.routeId);
    },
    render(routeId) {
      const url = routeUrls.get(routeId);
      if (url === undefined) return null;
      return serverRouteNode(
        createElement(RouteResourceReader, { routeId, url }),
      );
    },
    refreshActiveRoute() {
      const state = router.getState();
      if (state.status !== "idle" || rootData === null) return;
      const match = firstServerRouteMatch(state.matches);
      if (match === undefined) return;
      const url = payloadRouteUrl(state.location);
      routeUrls.set(match.routeId, url);
      void rootData
        .refreshData(routeResource, match.routeId, url)
        .then((result) => {
          if (result.status === "rejected") {
            reportPayloadFetchError(match.routeId, result.error, options);
          } else if (result.status === "fulfilled") {
            loadedKeys.add(loadedKey(match.routeId, url));
          }
        });
    },
    renderActiveRoute() {
      const state = router.getState();
      if (state.status !== "idle") return;
      const match = firstServerRouteMatch(state.matches);
      if (match === undefined) return;
      const url = payloadRouteUrl(state.location);
      routeUrls.set(match.routeId, url);
      void ensureRouteLoaded(match.routeId, url);
    },
    subscribe(routeId, listener) {
      let listeners = routeListeners.get(routeId);
      if (listeners === undefined) {
        listeners = new Set();
        routeListeners.set(routeId, listeners);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) routeListeners.delete(routeId);
      };
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

function readDataStream(): DataStream | null {
  const value = (globalThis as Record<string, unknown>)[DATA_STREAM_GLOBAL];
  return isDataStream(value) ? value : null;
}

function getDataStream(): DataStream {
  const current = readDataStream();
  if (current?.decoded === true) {
    appendMissingDataEntries(current, readDataFramesFromDocument());
    return current;
  }

  const stream = createDataStream(
    current === null
      ? readDataFramesFromDocument()
      : queuedPayloadDataEntries(current),
  );
  (globalThis as Record<string, unknown>)[DATA_STREAM_GLOBAL] = stream;
  if (current !== null) {
    appendMissingDataEntries(stream, readDataFramesFromDocument());
  }
  return stream;
}

function createDataStream(
  initialEntries: readonly PayloadDataHydrationEntry[],
): DataStream {
  let listeners: Array<(entries: readonly FigDataHydrationEntry[]) => void> =
    [];
  const seenEntries = new Set<string>();

  function decodeNewEntries(
    entries: readonly PayloadDataHydrationEntry[],
  ): FigDataHydrationEntry[] {
    // Dedup is per entry because Fig Start's server emits each data entry once
    // per stream, and re-read document frames are re-fed as whole encoded
    // frames. If data frames ever allow a new entry to ref a repeated entry
    // from another frame, this must move to frame-level dedupe before decode.
    const next: PayloadDataHydrationEntry[] = [];
    for (const entry of entries) {
      const key = JSON.stringify(entry);
      if (seenEntries.has(key)) continue;
      seenEntries.add(key);
      next.push(entry);
    }
    return decodePayloadDataEntries(next);
  }

  const stream: DataStream = {
    decoded: true,
    q: decodeNewEntries(initialEntries),
    p(entries) {
      const next = decodeNewEntries(entries);
      if (next.length === 0) return;
      stream.q.push(...next);
      for (const listener of listeners) listener(next);
    },
    s(listener) {
      listeners.push(listener);
      if (stream.q.length > 0) listener([...stream.q]);
      return () => {
        listeners = listeners.filter((item) => item !== listener);
      };
    },
  };
  return stream;
}

function queuedPayloadDataEntries(
  stream: DataStream,
): PayloadDataHydrationEntry[] {
  return stream.q as unknown as PayloadDataHydrationEntry[];
}

function isDataStream(value: unknown): value is DataStream {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { q?: unknown }).q) &&
    typeof (value as { p?: unknown }).p === "function" &&
    typeof (value as { s?: unknown }).s === "function"
  );
}

function readDataFramesFromDocument(): PayloadDataHydrationEntry[] {
  return Array.from(
    document.querySelectorAll(`script[${DATA_FRAME_ATTR}]`),
    (element) =>
      JSON.parse(element.textContent ?? "[]") as PayloadDataHydrationEntry[],
  ).flat();
}

// The shared transport getter reads-or-installs the queue global and replays
// document frames the queue missed (a bundle that executed mid-stream or
// without the bootstrap).
function getPayloadStream(): PayloadStream {
  return getPayloadFrameStream<SerializedPayloadFrame>(PAYLOAD_FRAME_TRANSPORT);
}

function appendMissingDataEntries(
  stream: DataStream,
  entries: readonly PayloadDataHydrationEntry[],
): void {
  if (entries.length > 0) stream.p(entries);
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
