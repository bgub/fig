import {
  createElement,
  type ElementType,
  type FigNode,
  ErrorBoundary,
  type Props,
  readPromise,
  Suspense,
  useExternalStore,
} from "@bgub/fig";
import {
  figResourceKey,
  type FigDataHydrationEntry,
  type FigDataStoreHandle,
} from "@bgub/fig/internal";
import { hydrateRoot, insertAssetResources } from "@bgub/fig-dom";
import {
  createRscResponse,
  fetchRsc,
  isRscRequestCancelled,
  type RscClientReferenceMetadata,
} from "@bgub/fig-server/rsc";
import {
  CLIENT_REFERENCE_MODULES_GLOBAL,
  DATA_SCRIPT_ID,
  DATA_FRAME_ATTR,
  DATA_STREAM_GLOBAL,
  hasClientReferences,
  ROOT_ELEMENT_ID,
  RSC_FRAME_ATTR,
  RSC_PAYLOAD_SCRIPT_ID,
  RSC_SEGMENTS_SCRIPT_ID,
  RSC_STREAM_GLOBAL,
  ROUTER_STATE_SCRIPT_ID,
  type SerializedRscFrame,
  type SerializedRouterState,
  type SerializedRscPayload,
  type SerializedRscSegment,
} from "./bootstrap.ts";
import {
  RouterProvider,
  ServerRouteContentProvider,
  type ServerRouteContentStore,
} from "./components.tsx";
import type { RouteMatch, Router } from "./core.ts";
import { isServerRoute } from "./internal.ts";
import { createRouter, type FigRouter, type RouterHistory } from "./router.ts";
import type { AnyRoute } from "./route.ts";
import type { RouterLocation } from "./types.ts";

type ServerRouteResponse = ReturnType<typeof createRscResponse>;

export interface StartClientOptions {
  container?: Element | null;
  context?: unknown;
  // Resolve a server route's client-reference ids back to components. With the
  // @bgub/fig-start/vite plugin, pass the generated manifest's loadClientReference.
  loadClientReference?: (
    metadata: RscClientReferenceMetadata,
  ) => Promise<unknown>;
  onRecoverableError?: (error: unknown) => void;
  resolveClientReference?: (
    metadata: RscClientReferenceMetadata,
  ) => ElementType | undefined;
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

  const serverRouteContent = createServerRouteContent(options, router);

  // If the matched route was a `.server.tsx`, the document carries its RSC
  // payload. Newer payloads arrive as streamed segment frames; keep the old
  // buffered script as a fallback so older server output still hydrates.
  const rscSegments = readJson<SerializedRscSegment[]>(
    RSC_SEGMENTS_SCRIPT_ID,
    [],
  );
  if (rscSegments.length > 0) {
    const stream = getRscStream();
    for (const segment of rscSegments) {
      serverRouteContent.receiveSegment(
        segment,
        stream,
        rscRouteUrl(router.getState().location),
      );
    }
  }

  const legacyRscPayload = readJson<SerializedRscPayload | null>(
    RSC_PAYLOAD_SCRIPT_ID,
    null,
  );
  if (legacyRscPayload !== null) {
    serverRouteContent.receiveBuffered(
      legacyRscPayload,
      rscRouteUrl(router.getState().location),
    );
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
  installLinkInterceptor(router);
  installPopStateHandler(router);

  return router;
}

interface RscStream {
  p(frame: SerializedRscFrame): void;
  q: SerializedRscFrame[];
  s(listener: (frame: SerializedRscFrame) => void): () => void;
}

interface DataStream {
  p(entries: readonly FigDataHydrationEntry[]): void;
  q: FigDataHydrationEntry[];
  s(listener: (entries: readonly FigDataHydrationEntry[]) => void): () => void;
}

function createServerRouteResponse(
  options: StartClientOptions,
  clientReferenceHydrationGate?: ClientReferenceHydrationGate,
): ServerRouteResponse {
  if (clientReferenceHydrationGate !== undefined) {
    return createRscResponse({
      resolveClientReference: (metadata) =>
        createHydratableClientReference(
          options,
          metadata,
          clientReferenceHydrationGate,
        ),
    });
  }

  return createRscResponse({
    loadClientReference: options.loadClientReference,
    resolveClientReference: options.resolveClientReference,
  });
}

function createHydratableClientReference(
  options: StartClientOptions,
  metadata: RscClientReferenceMetadata,
  hydrationGate: ClientReferenceHydrationGate,
): ElementType {
  if (metadata.ssr === true) {
    return createSsrHydratableClientReference(options, metadata);
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

function createSsrHydratableClientReference(
  options: StartClientOptions,
  metadata: RscClientReferenceMetadata,
): ElementType {
  const resolved =
    resolvePreloadedClientReference(metadata) ??
    options.resolveClientReference?.(metadata);

  return function StartSsrHydratableClientReference(
    props: Props & { children?: FigNode },
  ): FigNode {
    if (resolved !== undefined) return createElement(resolved, props);
    throw new Error(
      `Client reference "${metadata.id}" was server-rendered but was not preloaded before hydration.`,
    );
  };
}

function clientReferencePlaceholder(metadata: { id: string }): FigNode {
  return createElement("template", {
    "data-fig-client-reference": metadata.id,
  });
}

function resolvePreloadedClientReference(
  metadata: RscClientReferenceMetadata,
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
  receiveBuffered(payload: SerializedRscPayload, url: string): void;
  receiveSegment(
    segment: SerializedRscSegment,
    stream: RscStream,
    url: string,
  ): void;
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
  refresh(url: string): void;
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
      refresh(url) {
        if (url === entry.currentUrl) return;
        entry.currentUrl = url;
        entry.activeRefresh?.abort();
        const controller = new AbortController();
        entry.activeRefresh = controller;
        loadServerRouteRsc(
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

  function receiveRows(
    entry: ServerRouteEntry,
    rows: string,
    requireResolver: boolean,
  ): void {
    if (requireResolver) {
      requireClientReferenceResolverForRows(entry.routeId, rows, options);
    }
    entry.response.processStringChunk(rows);
    ensureEntryAssets(entry);
    notify(entry);
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
    receiveBuffered(payload, url) {
      const clientReferenceHydrationGate = createClientReferenceHydrationGate();
      const entry = createEntry(
        payload.routeId,
        createServerRouteResponse(options, clientReferenceHydrationGate),
        {
          clientReferenceHydrationGate,
          hydrateWithPendingAssets: true,
          url,
        },
      );
      receiveRows(entry, payload.rows, true);
    },
    receiveSegment(segment, stream, url) {
      const clientReferenceHydrationGate = createClientReferenceHydrationGate();
      const entry = createEntry(
        segment.routeId,
        createServerRouteResponse(options, clientReferenceHydrationGate),
        {
          clientReferenceHydrationGate,
          hydrateWithPendingAssets: true,
          url,
        },
      );
      const unsubscribe = stream.s((frame) => {
        if (frame.id !== segment.id) return;
        receiveRows(entry, frame.chunk, true);
      });
      entry.dispose = combineDisposers(entry.dispose, unsubscribe);
    },
    render(routeId) {
      const entry = entries.get(routeId);
      if (entry === undefined) return null;
      if (
        (entry.assetGate !== null &&
          !entry.revealed &&
          !entry.hydrateWithPendingAssets) ||
        !entry.payloadComplete
      )
        return null;
      entry.revealed = true;
      return serverRouteNode(entry.node);
    },
    renderActiveRoute() {
      const state = router.getState();
      if (state.status !== "idle") return;
      const match = firstServerRouteMatch(state.matches);
      if (match === undefined) return;
      const url = rscRouteUrl(state.location);
      const existing = entryForRoute(match.routeId);
      if (existing !== undefined) {
        control(existing).refresh(url);
        return;
      }

      const response = createServerRouteResponse(options);
      const controller = new AbortController();
      const entry = createEntry(match.routeId, response, {
        dispose: () => controller.abort(),
        // Client navigation reveals server routes atomically after the RSC fetch;
        // initial document streams keep their default progressive reveal behavior.
        payloadComplete: false,
        url,
      });

      loadServerRouteRsc(
        response,
        match.routeId,
        url,
        options,
        controller.signal,
        control(entry),
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

function serverRouteNode(node: FigNode): FigNode {
  return createElement(
    ErrorBoundary,
    { fallback: createElement("div", { "data-fig-rsc-error": "" }) },
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
    const key = figResourceKey(resource);
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

function firstServerRouteMatch(
  matches: readonly RouteMatch[],
): RouteMatch | undefined {
  return matches.find((match) => isServerRoute(match.node.route));
}

function loadServerRouteRsc(
  response: ServerRouteResponse,
  routeId: string,
  url: string,
  options: StartClientOptions,
  signal: AbortSignal,
  control: ServerRouteControl,
  refreshBoundary?: string,
): void {
  void fetchServerRouteRsc(
    response,
    routeId,
    url,
    options,
    signal,
    refreshBoundary,
  ).then(
    () => control.complete(),
    (error: unknown) => {
      if (isRscRequestCancelled(error)) return;
      reportRscFetchError(routeId, error, options);
      control.complete();
    },
  );
}

function fetchServerRouteRsc(
  response: ServerRouteResponse,
  routeId: string,
  url: string,
  options: StartClientOptions,
  signal: AbortSignal,
  refreshBoundary?: string,
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
    refreshBoundary,
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

function readDataStream(): DataStream | null {
  const value = (globalThis as Record<string, unknown>)[DATA_STREAM_GLOBAL];
  return isDataStream(value) ? value : null;
}

function getDataStream(): DataStream {
  const current = readDataStream();
  if (current !== null) {
    appendMissingDataEntries(current, readDataFramesFromDocument());
    return current;
  }

  const stream = createDataStream(readDataFramesFromDocument());
  (globalThis as Record<string, unknown>)[DATA_STREAM_GLOBAL] = stream;
  return stream;
}

function createDataStream(
  initialEntries: readonly FigDataHydrationEntry[],
): DataStream {
  let listeners: Array<(entries: readonly FigDataHydrationEntry[]) => void> =
    [];
  const stream: DataStream = {
    q: [...initialEntries],
    p(entries) {
      const next = [...entries];
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

function isDataStream(value: unknown): value is DataStream {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { q?: unknown }).q) &&
    typeof (value as { p?: unknown }).p === "function" &&
    typeof (value as { s?: unknown }).s === "function"
  );
}

function readDataFramesFromDocument(): FigDataHydrationEntry[] {
  return Array.from(
    document.querySelectorAll(`script[${DATA_FRAME_ATTR}]`),
    (element) =>
      JSON.parse(element.textContent ?? "[]") as FigDataHydrationEntry[],
  ).flat();
}

function readRscStream(): RscStream | null {
  const value = (globalThis as Record<string, unknown>)[RSC_STREAM_GLOBAL];
  return isRscStream(value) ? value : null;
}

function getRscStream(): RscStream {
  const current = readRscStream();
  if (current !== null) {
    appendMissingRscFrames(current, readRscFramesFromDocument());
    return current;
  }

  const stream = createRscStream(readRscFramesFromDocument());
  (globalThis as Record<string, unknown>)[RSC_STREAM_GLOBAL] = stream;
  return stream;
}

function appendMissingDataEntries(
  stream: DataStream,
  entries: readonly FigDataHydrationEntry[],
): void {
  const seen = new Set(stream.q.map((entry) => JSON.stringify(entry)));
  const next = entries.filter((entry) => {
    const key = JSON.stringify(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (next.length > 0) stream.p(next);
}

function appendMissingRscFrames(
  stream: RscStream,
  frames: readonly SerializedRscFrame[],
): void {
  const seen = new Set(stream.q.map((frame) => JSON.stringify(frame)));
  for (const frame of frames) {
    const key = JSON.stringify(frame);
    if (seen.has(key)) continue;
    seen.add(key);
    stream.p(frame);
  }
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
