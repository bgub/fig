import {
  createElement,
  type DataResourceLoadContext,
  type ElementType,
  ErrorBoundary,
  type FigDataHydrationEntry,
  type FigDataStoreHandle,
  type FigNode,
  type Props,
  readPromise,
  Suspense,
  useExternalStore,
} from "@bgub/fig";
import { assetResourceKey } from "@bgub/fig/internal";
import { hydrateRoot, insertAssetResources } from "@bgub/fig-dom";
import {
  createPayloadResponse,
  decodePayloadDataEntries,
  decodePayloadDataEntry,
  decodePayloadValue,
  encodePayloadValue,
  fetchPayload,
  isPayloadRequestCancelled,
  type PayloadClientReferenceMetadata,
  type PayloadDataHydrationEntry,
  type PayloadResponse,
} from "@bgub/fig-server/payload";
import {
  CLIENT_REFERENCE_MODULES_GLOBAL,
  DATA_ENDPOINT_PATH,
  DATA_FRAME_ATTR,
  DATA_SCRIPT_ID,
  DATA_STREAM_GLOBAL,
  DEV_SERVER_UPDATE_EVENT,
  type DevServerUpdateMessage,
  PAYLOAD_FRAME_ATTR,
  PAYLOAD_SEGMENTS_SCRIPT_ID,
  PAYLOAD_STREAM_GLOBAL,
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
import type { RouteMatch, Router } from "./core.ts";
import { isServerRoute } from "./internal.ts";
import type { AnyRoute } from "./route.ts";
import { createRouter, type FigRouter, type RouterHistory } from "./router.ts";
import type { RouterLocation } from "./types.ts";

type ServerRouteResponse = ReturnType<typeof createPayloadResponse>;

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

  return router;
}

interface PayloadStream {
  p(frame: SerializedPayloadFrame): void;
  q: SerializedPayloadFrame[];
  s(listener: (frame: SerializedPayloadFrame) => void): () => void;
}

interface DataStream {
  decoded?: true;
  p(entries: readonly PayloadDataHydrationEntry[]): void;
  q: FigDataHydrationEntry[];
  s(listener: (entries: readonly FigDataHydrationEntry[]) => void): () => void;
}

function createServerRouteResponse(
  options: StartClientOptions,
  clientReferenceTypes: ClientReferenceTypeCache,
  clientReferenceHydrationGate?: ClientReferenceHydrationGate,
): ServerRouteResponse {
  if (clientReferenceHydrationGate !== undefined) {
    return createPayloadResponse({
      resolveClientReference: (metadata) =>
        createHydratableClientReference(
          options,
          metadata,
          clientReferenceTypes,
          clientReferenceHydrationGate,
        ),
    });
  }

  return createPayloadResponse({
    loadClientReference: options.loadClientReference,
    resolveClientReference: (metadata) =>
      resolveStableClientReference(options, metadata, clientReferenceTypes),
  });
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
    const hydrated = useExternalStore(
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

interface ServerRouteEntry {
  activeRefresh: AbortController | null;
  assetGate: Promise<void> | null;
  clientReferenceHydrationGate: ClientReferenceHydrationGate | null;
  currentUrl: string;
  dispose: () => void;
  hydrateWithPendingAssets: boolean;
  insertedAssetKeys: Set<string>;
  listeners: Set<() => void>;
  node: FigNode;
  onRecoverableError?: (error: unknown) => void;
  payloadComplete: boolean;
  response: ServerRouteResponse;
  revealed: boolean;
  routeId: string;
  unsubscribeResponse: (() => void) | null;
  version: number;
  visibleNode: FigNode;
}

interface ServerRouteEntryOptions {
  clientReferenceHydrationGate?: ClientReferenceHydrationGate;
  dispose?: () => void;
  hydrateWithPendingAssets?: boolean;
  payloadComplete?: boolean;
  url?: string;
}

interface ServerRouteControl {
  complete(): void;
  refresh(url: string, options?: { force?: boolean }): void;
}

interface ClientReferenceHydrationGate {
  getServerSnapshot(): boolean;
  getSnapshot(): boolean;
  reveal(): void;
  subscribe(listener: () => void): () => void;
}

function createServerRouteContent(
  options: StartClientOptions,
  router: FigRouter,
  clientReferenceTypes: ClientReferenceTypeCache,
): ServerRouteContent {
  const entries = new Map<string, ServerRouteEntry>();
  const pendingListeners = new Map<string, Set<() => void>>();
  let rootData: FigDataStoreHandle | null = null;

  function notify(entry: ServerRouteEntry): void {
    entry.version += 1;
    for (const listener of entry.listeners) listener();
  }

  function bindEntry(entry: ServerRouteEntry): void {
    if (rootData === null || entry.unsubscribeResponse !== null) return;

    entry.unsubscribeResponse = entry.response.bindRoot({
      data: rootData,
      render: (node) => {
        entry.node = node;
        ensureEntryAssets(entry);
        if (entry.assetGate === null) entry.visibleNode = entry.node;
        notify(entry);
      },
    });
  }

  function createEntry(
    routeId: string,
    response: ServerRouteResponse,
    entryOptions: ServerRouteEntryOptions = {},
  ): ServerRouteEntry {
    const dispose = entryOptions.dispose ?? (() => undefined);
    const existing = entries.get(routeId);
    if (existing !== undefined) {
      dispose();
      return existing;
    }

    const listeners = pendingListeners.get(routeId) ?? new Set<() => void>();
    pendingListeners.delete(routeId);

    const entry: ServerRouteEntry = {
      activeRefresh: null,
      assetGate: null,
      currentUrl: entryOptions.url ?? "",
      dispose,
      hydrateWithPendingAssets: entryOptions.hydrateWithPendingAssets ?? false,
      insertedAssetKeys: new Set(),
      clientReferenceHydrationGate:
        entryOptions.clientReferenceHydrationGate ?? null,
      listeners,
      node: response.getRoot(),
      onRecoverableError: options.onRecoverableError,
      payloadComplete: entryOptions.payloadComplete ?? true,
      response,
      revealed: false,
      routeId,
      unsubscribeResponse: null,
      version: 0,
      visibleNode: response.getRoot(),
    };
    entries.set(routeId, entry);
    bindEntry(entry);

    watchServerRouteLifetime(router, routeId, () => {
      entries.delete(routeId);
      entry.activeRefresh?.abort();
      entry.dispose();
      entry.unsubscribeResponse?.();
      notify(entry);
    });

    return entry;
  }

  function control(entry: ServerRouteEntry): ServerRouteControl {
    return {
      complete() {
        entry.payloadComplete = true;
        notify(entry);
      },
      refresh(url, refreshOptions) {
        if (url === entry.currentUrl && refreshOptions?.force !== true) return;
        entry.currentUrl = url;
        entry.activeRefresh?.abort();
        const controller = new AbortController();
        entry.activeRefresh = controller;
        loadServerRoutePayload(
          entry.response,
          entry.routeId,
          url,
          options,
          controller.signal,
          {
            complete() {
              if (entry.activeRefresh === controller)
                entry.activeRefresh = null;
            },
            refresh: () => undefined,
          },
          entry.routeId,
        );
      },
    };
  }

  function entryForRoute(routeId: string): ServerRouteEntry | undefined {
    return entries.get(routeId);
  }

  function startEntryFetch(routeId: string, url: string): ServerRouteEntry {
    const response = createServerRouteResponse(options, clientReferenceTypes);
    const controller = new AbortController();
    const entry = createEntry(routeId, response, {
      dispose: () => controller.abort(),
      // Client navigation reveals server routes atomically after the payload fetch;
      // initial document streams keep their default progressive reveal behavior.
      payloadComplete: false,
      url,
    });

    loadServerRoutePayload(
      response,
      routeId,
      url,
      options,
      controller.signal,
      control(entry),
    );
    return entry;
  }

  function receiveRows(entry: ServerRouteEntry, rows: string): void {
    entry.response.processStringChunk(rows);
    requireClientReferenceResolver(entry.routeId, entry.response, options);
    ensureEntryAssets(entry);
    notify(entry);
  }

  function entryRenderable(entry: ServerRouteEntry): boolean {
    return (
      entry.payloadComplete &&
      (entry.assetGate === null ||
        entry.revealed ||
        entry.hydrateWithPendingAssets)
    );
  }

  // Loading island modules before the commit lets the payload's client
  // references render synchronously on reveal instead of suspending the
  // freshly committed slot to its null fallback for a beat.
  function preloadEntryClientReferences(
    entry: ServerRouteEntry,
  ): Promise<void> | undefined {
    if (entries.get(entry.routeId) !== entry) return undefined;
    return entry.response.preloadClientReferences();
  }

  // Resolves when the entry can render (payload complete and assets settled),
  // or when the entry is torn down by a superseding navigation.
  function waitForEntryRenderable(
    entry: ServerRouteEntry,
  ): Promise<void> | undefined {
    if (entryRenderable(entry)) return undefined;

    return new Promise((resolve) => {
      const listener = (): void => {
        if (entries.get(entry.routeId) === entry && !entryRenderable(entry)) {
          return;
        }
        entry.listeners.delete(listener);
        resolve();
      };
      entry.listeners.add(listener);
    });
  }

  return {
    bindRootData(data) {
      rootData = data;
      for (const entry of entries.values()) bindEntry(entry);
    },
    commit(routeId) {
      const entry = entries.get(routeId);
      if (entry === undefined) return;
      ensureEntryAssets(entry);
      revealEntryClientReferences(entry);
    },
    getSnapshot(routeId) {
      return entries.get(routeId)?.version ?? 0;
    },
    receiveSegment(segment, stream, url) {
      const clientReferenceHydrationGate = createClientReferenceHydrationGate();
      const entry = createEntry(
        segment.routeId,
        createServerRouteResponse(
          options,
          clientReferenceTypes,
          clientReferenceHydrationGate,
        ),
        {
          clientReferenceHydrationGate,
          hydrateWithPendingAssets: true,
          url,
        },
      );
      const unsubscribe = stream.s((frame) => {
        if (frame.id !== segment.id) return;
        receiveRows(entry, frame.chunk);
      });
      entry.dispose = combineDisposers(entry.dispose, unsubscribe);
    },
    // Pre-commit gate for navigations that mount a NEW server route: without
    // a renderable entry, committing would swap the old page for an empty
    // slot. Same-route URL changes keep the entry mounted; a gated refresh
    // renders the last visible node until the newly decoded node's assets are
    // ready.
    async prepare(location, matches) {
      const match = firstServerRouteMatch(matches);
      if (match === undefined) return;

      const entry =
        entries.get(match.routeId) ??
        startEntryFetch(match.routeId, payloadRouteUrl(location));
      await waitForEntryRenderable(entry);
      await preloadEntryClientReferences(entry);
    },
    render(routeId) {
      const entry = entries.get(routeId);
      if (entry === undefined) return null;
      if (!entryRenderable(entry)) return null;
      entry.revealed = true;
      return serverRouteNode(entry.visibleNode);
    },
    refreshActiveRoute() {
      refreshActiveServerRoute(
        router,
        entryForRoute,
        startEntryFetch,
        (entry) =>
          control(entry).refresh(payloadRouteUrl(router.getState().location), {
            force: true,
          }),
      );
    },
    renderActiveRoute() {
      refreshActiveServerRoute(
        router,
        entryForRoute,
        startEntryFetch,
        (entry) =>
          control(entry).refresh(payloadRouteUrl(router.getState().location)),
      );
    },
    subscribe(routeId, listener) {
      const entry = entries.get(routeId);
      if (entry !== undefined) {
        entry.listeners.add(listener);
        return () => {
          entry.listeners.delete(listener);
        };
      }

      let listeners = pendingListeners.get(routeId);
      if (listeners === undefined) {
        listeners = new Set();
        pendingListeners.set(routeId, listeners);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) pendingListeners.delete(routeId);
      };
    },
  };
}

function refreshActiveServerRoute(
  router: FigRouter,
  entryForRoute: (routeId: string) => ServerRouteEntry | undefined,
  startEntryFetch: (routeId: string, url: string) => ServerRouteEntry,
  refreshEntry: (entry: ServerRouteEntry) => void,
): void {
  const state = router.getState();
  if (state.status !== "idle") return;
  const match = firstServerRouteMatch(state.matches);
  if (match === undefined) return;
  const url = payloadRouteUrl(state.location);
  const existing = entryForRoute(match.routeId);
  if (existing !== undefined) {
    refreshEntry(existing);
    return;
  }

  startEntryFetch(match.routeId, url);
}

function serverRouteNode(node: FigNode): FigNode {
  return createElement(
    ErrorBoundary,
    { fallback: createElement("div", { "data-fig-payload-error": "" }) },
    createElement(Suspense, { fallback: null }, node),
  );
}

function combineDisposers(first: () => void, second: () => void): () => void {
  return () => {
    first();
    second();
  };
}

function ensureEntryAssets(entry: ServerRouteEntry): void {
  const nextGate = insertNewServerRouteAssets(
    entry.response,
    entry.insertedAssetKeys,
  );
  if (nextGate !== null) armEntryGate(entry, nextGate);
}

function armEntryGate(entry: ServerRouteEntry, nextGate: Promise<void>): void {
  entry.assetGate = combineAssetGates(entry.assetGate, nextGate);
  const currentGate = entry.assetGate;
  void currentGate.then(
    () => settleEntryGate(entry, currentGate),
    (error: unknown) => settleEntryGate(entry, currentGate, error),
  );
}

function settleEntryGate(
  entry: ServerRouteEntry,
  currentGate: Promise<void>,
  error?: unknown,
): void {
  if (error !== undefined) entry.onRecoverableError?.(error);
  if (entry.assetGate !== currentGate) return;
  entry.assetGate = null;
  revealEntryClientReferences(entry);
  entry.visibleNode = entry.node;
  entry.version += 1;
  for (const listener of entry.listeners) listener();
}

function revealEntryClientReferences(entry: ServerRouteEntry): void {
  if (entry.assetGate !== null) return;
  entry.clientReferenceHydrationGate?.reveal();
}

function insertNewServerRouteAssets(
  response: ServerRouteResponse,
  insertedAssetKeys: Set<string>,
): Promise<void> | null {
  const newAssets = response.getAssetResources().filter((resource) => {
    const key = assetResourceKey(resource);
    if (insertedAssetKeys.has(key)) return false;
    insertedAssetKeys.add(key);
    return true;
  });

  return newAssets.length === 0 ? null : insertAssetResources(newAssets);
}

function combineAssetGates(
  current: Promise<void> | null,
  next: Promise<void>,
): Promise<void> {
  return current === null
    ? next
    : Promise.all([current, next]).then(() => undefined);
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

function loadServerRoutePayload(
  response: ServerRouteResponse,
  routeId: string,
  url: string,
  options: StartClientOptions,
  signal: AbortSignal,
  control: ServerRouteControl,
  refreshBoundary?: string,
): void {
  void fetchServerRoutePayload(
    response,
    routeId,
    url,
    options,
    signal,
    refreshBoundary,
  ).then(
    () => control.complete(),
    (error: unknown) => {
      if (isPayloadRequestCancelled(error)) return;
      reportPayloadFetchError(routeId, error, options);
      control.complete();
    },
  );
}

async function fetchServerRoutePayload(
  response: ServerRouteResponse,
  routeId: string,
  url: string,
  options: StartClientOptions,
  signal: AbortSignal,
  refreshBoundary?: string,
): Promise<Response> {
  const result = await fetchPayload(response, url, { refreshBoundary, signal });
  // The response has decoded the full payload; a payload with client
  // references but no configured resolver would render placeholders forever,
  // so fail loudly instead.
  requireClientReferenceResolver(routeId, response, options);
  return result;
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

// Exported for testing: the missing-resolver guard and the navigation-teardown
// watcher are pure logic, so they're verified without a DOM.
export function requireClientReferenceResolver(
  routeId: string,
  response: Pick<PayloadResponse, "getClientReferences">,
  options: Pick<
    StartClientOptions,
    "loadClientReference" | "resolveClientReference"
  >,
): void {
  if (
    !hasClientReferenceResolver(options) &&
    response.getClientReferences().length > 0
  ) {
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
  const stream: DataStream = {
    decoded: true,
    q: initialEntries.map(decodePayloadDataEntry),
    p(entries) {
      const next = entries.map(decodePayloadDataEntry);
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

function readPayloadStream(): PayloadStream | null {
  const value = (globalThis as Record<string, unknown>)[PAYLOAD_STREAM_GLOBAL];
  return isPayloadStream(value) ? value : null;
}

function getPayloadStream(): PayloadStream {
  const current = readPayloadStream();
  if (current !== null) {
    appendMissingPayloadFrames(current, readPayloadFramesFromDocument());
    return current;
  }

  const stream = createPayloadStream(readPayloadFramesFromDocument());
  (globalThis as Record<string, unknown>)[PAYLOAD_STREAM_GLOBAL] = stream;
  return stream;
}

function appendMissingDataEntries(
  stream: DataStream,
  entries: readonly PayloadDataHydrationEntry[],
): void {
  const seen = new Set(stream.q.map((entry) => JSON.stringify(entry)));
  const next = entries.filter((entry) => {
    const decoded = decodePayloadDataEntry(entry);
    const key = JSON.stringify(decoded);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (next.length > 0) stream.p(next);
}

function appendMissingPayloadFrames(
  stream: PayloadStream,
  frames: readonly SerializedPayloadFrame[],
): void {
  const seen = new Set(stream.q.map((frame) => JSON.stringify(frame)));
  for (const frame of frames) {
    const key = JSON.stringify(frame);
    if (seen.has(key)) continue;
    seen.add(key);
    stream.p(frame);
  }
}

function createPayloadStream(
  initialFrames: readonly SerializedPayloadFrame[],
): PayloadStream {
  let listeners: Array<(frame: SerializedPayloadFrame) => void> = [];
  const stream: PayloadStream = {
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

function isPayloadStream(value: unknown): value is PayloadStream {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { q?: unknown }).q) &&
    typeof (value as { p?: unknown }).p === "function" &&
    typeof (value as { s?: unknown }).s === "function"
  );
}

function readPayloadFramesFromDocument(): SerializedPayloadFrame[] {
  return Array.from(
    document.querySelectorAll(`script[${PAYLOAD_FRAME_ATTR}]`),
    (element) =>
      JSON.parse(element.textContent ?? "") as SerializedPayloadFrame,
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
