import {
  createElement,
  type FigClientReference,
  type FigDataHydrationEntry,
  type FigNode,
  type FigAssetResource,
  type FigAssetResourceList,
  Fragment,
  assets,
  type Props,
} from "@bgub/fig";
import { assetResourceKey } from "@bgub/fig/internal";
import {
  dataResource,
  type DataResource,
  type DataResourceKey,
  type DataResourceKeyInput,
  type DataResourceLoadContext,
} from "@bgub/fig-data";
import { normalizeDataResourceKey } from "@bgub/fig-data/internal";
import {
  escapeAttribute,
  escapeText,
  renderToDocumentStream,
} from "@bgub/fig-server";
import {
  createPayloadResponse,
  decodePayloadValue,
  encodePayloadDataEntries,
  encodePayloadValue,
  PayloadBoundary,
  type PayloadClientReferenceRecord,
  type PayloadDataHydrationEntry,
  type PayloadModel,
  renderToPayloadStream,
} from "@bgub/fig-server/payload";
import type { Server } from "node:http";
import {
  DATA_SCRIPT_ID,
  DATA_ENDPOINT_PATH,
  DATA_FRAME_ATTR,
  DATA_STREAM_GLOBAL,
  PAYLOAD_BOUNDARY_HEADER,
  PAYLOAD_FRAME_ATTR,
  PAYLOAD_ROUTE_ID_HEADER,
  PAYLOAD_SEGMENT_ID_HEADER,
  ROOT_ELEMENT_ID,
  PAYLOAD_SEGMENTS_SCRIPT_ID,
  PAYLOAD_STREAM_GLOBAL,
  CLIENT_REFERENCE_MODULES_GLOBAL,
  ROUTER_STATE_SCRIPT_ID,
  type SerializedPayloadFrame,
  type SerializedPayloadSegment,
  type SerializedRouterState,
} from "./bootstrap.ts";
import {
  Outlet,
  RouterProvider,
  ServerRouteContentProvider,
  ServerRouteRenderProvider,
  type ServerRouteContentStore,
} from "./components.tsx";
import type { RouteMatch, Router } from "./core.ts";
import { isServerRoute, resolveServerClientReference } from "./internal.ts";
import type { LoadResult } from "./router.ts";
import { createRouter } from "./router.ts";
import { RouterContext } from "./router-context.ts";
import type { AnyRoute } from "./route.ts";
import { contentTypeFor } from "./server-runtime/content-type.ts";
import { runStartRuntime } from "./server-runtime/runtime.ts";

export { StartConfigError, StartListenError } from "./server-runtime/errors.ts";

export interface StartHandlerOptions {
  assets?: Record<string, StartStaticAssetInput>;
  clientReferenceAssets?: (metadata: { id: string }) => FigAssetResourceList;
  // URL of the built client entry module, as served (e.g. "/client.js").
  clientEntry: string;
  // Per-request context for beforeLoad/loader (e.g. a data/query client). May
  // return a promise; it is awaited before routing.
  context?: (request: Request) => unknown;
  // Extra <head> content (e.g. <title>, <meta>). fig-server lowers host
  // title/meta/link into hoisted document resources.
  head?: FigNode;
  // Per-request props for the framework-owned <html> element.
  html?: (request: Request) => Props;
  htmlLang?: string;
  nonce?: (request: Request) => string;
  routes: readonly AnyRoute[];
  serverDataResources?: Record<string, unknown>;
  serverRouteAssets?: (metadata: { id: string }) => FigAssetResourceList;
}

export type StartHandler = (request: Request) => Promise<Response>;

export type StartServerDataResource = Pick<
  DataResource<never[], unknown>,
  "key" | "load"
>;

export interface RemoteDataResourceOptions<TArgs extends unknown[], TValue> {
  key: (...args: TArgs) => DataResourceKey;
  load: (
    ...argsAndContext: [...TArgs, DataResourceLoadContext]
  ) => TValue | PromiseLike<TValue>;
  debugArgs?: (...args: TArgs) => DataResourceKeyInput;
}

// A server resource that additionally serves direct browser refreshes: Fig
// Start registers it behind the framework data endpoint under a generated id,
// and the transform compiles browser imports into a plain dataResource whose
// loader calls that endpoint. Only declarable in .server.ts(x) files — the
// loader is a public request handler, so it must validate and authorize its
// client-controlled arguments.
export function remoteDataResource<TArgs extends unknown[], TValue>(
  options: RemoteDataResourceOptions<TArgs, TValue>,
): DataResource<TArgs, TValue> {
  return dataResource(options);
}

type StartServerDataResourceLoadContext = {
  signal: AbortSignal;
};

interface CallableStartServerDataResource {
  key: (...args: unknown[]) => DataResourceKey;
  load: (
    ...argsAndContext: [...unknown[], StartServerDataResourceLoadContext]
  ) => unknown;
}

// Web-standard request handler (use directly on edge runtimes or in tests).
// Most apps use startServer() instead.
export function createRequestHandler(
  options: StartHandlerOptions,
): StartHandler {
  const staticAssets = normalizeStaticAssets(options.assets);

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const asset = staticAssets.get(url.pathname);
    if (asset !== undefined) {
      return new Response(asset.content as BodyInit, {
        headers: {
          "content-type": asset.contentType ?? contentTypeFor(url.pathname),
        },
      });
    }

    if (url.pathname === DATA_ENDPOINT_PATH) {
      return handleDataResourceRequest(options, request);
    }

    const routerContext = (await options.context?.(request)) ?? {};
    const router = createRouter({
      context: routerContext,
      routes: options.routes,
    });
    const location = router.buildLocation(url.pathname + url.search + url.hash);

    const result = await router.load(location);
    if (result.status === "redirect") {
      return new Response(null, {
        headers: { location: result.redirect.to },
        status: result.redirect.replace === true ? 301 : 302,
      });
    }

    router.commit(location, result);
    const status = result.status === "notFound" ? 404 : 200;
    const nonce = options.nonce?.(request);
    const isPayloadRequest = isPayloadRouteRequest(request);
    const refreshBoundary = isPayloadRequest
      ? payloadBoundaryHeader(request)
      : undefined;
    // A `.server.tsx` route segment renders through the payload stream. The document
    // render can stream server-renderable HTML into the same slot, then the client
    // mounts and refreshes the payload for that segment.
    const payloadSegment = renderServerRouteSegment(
      result,
      router,
      options.clientReferenceAssets,
      options.serverRouteAssets,
      refreshBoundary,
    );

    if (isPayloadRequest) {
      if (payloadSegment === undefined) {
        return new Response("No payload segment for route.", { status: 404 });
      }
      if (
        refreshBoundary !== undefined &&
        refreshBoundary !== payloadSegment.metadata.routeId
      ) {
        return new Response(
          "Payload boundary does not match the route segment.",
          {
            status: 400,
          },
        );
      }

      return new Response(streamPayloadSegmentRows(payloadSegment), {
        headers: {
          "content-type": payloadSegment.contentType,
          [PAYLOAD_ROUTE_ID_HEADER]: payloadSegment.metadata.routeId,
          [PAYLOAD_SEGMENT_ID_HEADER]: payloadSegment.metadata.id,
        },
        status,
      });
    }

    const documentPayload =
      payloadSegment === undefined
        ? undefined
        : createDocumentPayloadSegment(payloadSegment);
    await documentPayload?.initialRootReady;
    const hoistedServerRouteResources = uniqueResources([
      ...(payloadSegment?.initialResources ?? []),
      ...(documentPayload?.assetResources() ?? []),
    ]);
    const routerTree = createElement(
      ServerRouteRenderProvider,
      { mode: "document" },
      createElement(RouterProvider, { router }),
    );
    const appTree =
      documentPayload === undefined
        ? routerTree
        : createElement(
            ServerRouteContentProvider,
            { store: documentPayload.store },
            routerTree,
          );
    const htmlProps = options.html?.(request) ?? {};
    const document = createElement(
      "html",
      { lang: options.htmlLang ?? "en", ...htmlProps },
      createElement(
        "head",
        null,
        createElement("meta", { charset: "utf-8" }),
        createElement("meta", {
          content: "width=device-width, initial-scale=1",
          name: "viewport",
        }),
        hoistedServerRouteResources.length === 0
          ? null
          : assets(hoistedServerRouteResources),
        options.head ?? null,
      ),
      createElement(
        "body",
        null,
        createElement("div", { id: ROOT_ELEMENT_ID }, appTree),
      ),
    );

    const render = renderToDocumentStream(document, {
      clientReferenceFallback: clientReferencePlaceholder,
      nonce,
      onError: () => ({ digest: "fig-start-error" }),
    });

    try {
      await render.shellReady;
    } catch (error) {
      return new Response(shellErrorHtml(error), {
        headers: { "content-type": "text/html; charset=utf-8" },
        status: 500,
      });
    }

    const payloadSegments =
      payloadSegment === undefined ? [] : [payloadSegment.metadata];
    const payloadFrameStream =
      documentPayload === undefined
        ? undefined
        : streamPayloadSegmentFrames(documentPayload.frames, nonce);
    const dataStream = createDocumentDataStream(nonce);
    const clientReferenceModules =
      documentPayload === undefined
        ? []
        : initialClientReferenceModules(documentPayload.clientReferences());

    return new Response(
      injectDocumentStreams(render.stream, {
        afterBodyOpen: () =>
          renderStreamPrelude({
            hasPayloadSegments: payloadSegments.length > 0,
            nonce,
          }),
        beforeBodyClose: () =>
          renderBootstrap({
            clientEntry: options.clientEntry,
            clientReferenceModules,
            dataEntries: dataStream.initial(render.getData()),
            location: location.href,
            loaderData: collectLoaderData(result),
            nonce,
            payloadSegments,
          }),
        beforeHtmlChunk: () => dataStream.flush(render.getData()),
        companionStreams:
          payloadFrameStream === undefined ? [] : [payloadFrameStream],
      }),
      {
        headers: { "content-type": render.contentType },
        status,
      },
    );
  };
}

export interface StartServerOptions extends Omit<
  StartHandlerOptions,
  "clientEntry"
> {
  // Base URL the built client assets sit next to — pass `import.meta.url`. The
  // framework serves `./client.js` (next to your server bundle) automatically.
  appUrl: string;
  cacheClientAssets?: boolean;
  clientEntry?: string;
  mode?: "development" | "production";
  port?: number;
  publicUrl?: string;
}

export interface StartStaticAsset {
  content: string | Uint8Array;
  contentType?: string;
}

export type StartStaticAssetInput = string | Uint8Array | StartStaticAsset;

// The batteries-included entry: builds the request handler, serves built client
// assets, handles status codes and headers, and listens — through the same
// Effect runtime as the dev server. An app's server entry is just
// `startServer({ routes, appUrl: import.meta.url, ... })`. Rejects with
// StartConfigError / StartListenError; SIGINT/SIGTERM close the listening
// socket gracefully before the process terminates.
export function startServer(options: StartServerOptions): Promise<Server> {
  const {
    appUrl,
    cacheClientAssets,
    clientEntry,
    mode,
    port,
    publicUrl,
    ...handlerOptions
  } = options;

  return runStartRuntime({
    config: { appUrl, cacheClientAssets, clientEntry, mode, port, publicUrl },
    handlerOptions,
    log: console.log,
  });
}

function normalizeStaticAssets(
  assets: Record<string, StartStaticAssetInput> | undefined,
): Map<string, StartStaticAsset> {
  const result = new Map<string, StartStaticAsset>();
  if (assets === undefined) return result;

  for (const [path, value] of Object.entries(assets)) {
    const pathname = path.startsWith("/") ? path : `/${path}`;
    result.set(pathname, normalizeStaticAsset(value));
  }

  return result;
}

function normalizeStaticAsset(value: StartStaticAssetInput): StartStaticAsset {
  return typeof value === "object" && !(value instanceof Uint8Array)
    ? value
    : { content: value };
}

function collectLoaderData(result: LoadResult): Record<string, unknown> {
  if (result.status !== "match") return {};
  const loaderData: Record<string, unknown> = {};
  for (const match of result.matches) {
    if (match.loaderData !== undefined) {
      loaderData[match.routeId] = match.loaderData;
    }
  }
  return loaderData;
}

interface ServerPayloadSegment {
  contentType: string;
  initialResources: readonly FigAssetResource[];
  metadata: SerializedPayloadSegment;
  stream: ReadableStream<Uint8Array>;
}

interface DocumentPayloadSegment {
  assetResources(): readonly FigAssetResource[];
  clientReferences(): readonly PayloadClientReferenceRecord[];
  frames: ServerPayloadSegment;
  initialRootReady: Promise<void>;
  store: ServerRouteContentStore;
}

interface ClientReferenceModule {
  id: string;
  module: string;
}

function createDocumentPayloadSegment(
  segment: ServerPayloadSegment,
): DocumentPayloadSegment {
  const [decodeStream, frameStream] = segment.stream.tee();
  const response = createPayloadResponse({
    resolveClientReference: (metadata) =>
      metadata.ssr === true
        ? resolveServerClientReference(metadata)
        : undefined,
  });
  const initialRootReady = decodeDocumentPayloadStream(response, decodeStream);

  return {
    assetResources: () => response.getAssetResources(),
    clientReferences: () => response.getClientReferences(),
    frames: { ...segment, stream: frameStream },
    initialRootReady,
    store: createDocumentServerRouteContentStore(
      segment.metadata.routeId,
      response.getRoot(),
    ),
  };
}

// Waits for the initial root row (or one tick, whichever is first) so the
// document render can include server-renderable payload markup when the payload
// is already buffered, without blocking the shell on slow segments.
function decodeDocumentPayloadStream(
  response: ReturnType<typeof createPayloadResponse>,
  stream: ReadableStream<Uint8Array>,
): Promise<void> {
  void response.processStream(stream).catch(() => undefined);

  return Promise.race([
    response.rootReady,
    new Promise<void>((resolve) => setTimeout(resolve, 0)),
  ]);
}

function createDocumentServerRouteContentStore(
  routeId: string,
  node: FigNode,
): ServerRouteContentStore {
  return {
    commit: () => undefined,
    getSnapshot: () => 0,
    render: (requestedRouteId) =>
      requestedRouteId === routeId ? node : undefined,
    subscribe: () => () => undefined,
  };
}

function initialClientReferenceModules(
  references: readonly PayloadClientReferenceRecord[],
): ClientReferenceModule[] {
  const seen = new Set<string>();
  const modules: ClientReferenceModule[] = [];

  for (const reference of references) {
    if (reference.ssr !== true) continue;
    const module = reference.assets?.find(
      (resource) => resource.kind === "modulepreload",
    );
    if (module === undefined || seen.has(reference.id)) continue;
    seen.add(reference.id);
    modules.push({ id: reference.id, module: module.href });
  }

  return modules;
}

function renderServerRouteSegment(
  result: LoadResult,
  router: Router,
  clientReferenceAssets:
    | ((metadata: { id: string }) => FigAssetResourceList)
    | undefined,
  serverRouteAssets:
    | ((metadata: { id: string }) => FigAssetResourceList)
    | undefined,
  refreshBoundary: string | undefined,
): ServerPayloadSegment | undefined {
  if (result.status !== "match") return undefined;
  const segment = firstServerRouteSegment(result.matches);
  if (segment === undefined) return undefined;

  const routeAssets = serverRouteAssetList(
    result.matches.slice(segment.index),
    serverRouteAssets,
  );
  const routeNode = createElement(
    RouterContext,
    { value: router },
    createElement(
      ServerRouteRenderProvider,
      { depth: segment.index, mode: "content" },
      createElement(Outlet),
    ),
  );
  const routeId = segment.match.routeId;
  const routeContent =
    routeAssets.length === 0 ? routeNode : assets(routeAssets, routeNode);
  const refreshesSegment = refreshBoundary === routeId;
  const payload = renderToPayloadStream(
    createElement(
      Fragment,
      null,
      refreshesSegment
        ? routeContent
        : createElement(PayloadBoundary, { id: routeId }, routeContent),
    ),
    {
      clientReferenceAssets,
      // A throw inside a server component becomes a payload "error" row (it
      // doesn't reject allReady), so the request would otherwise return 200
      // with no server log. Log it here; only the digest crosses the wire and
      // the client error boundary renders on its side.
      onError(error) {
        console.error(
          `[fig-start] server route "${routeId}" failed to render:`,
          error,
        );
        return { digest: "fig-start-error" };
      },
      refreshBoundary: refreshesSegment ? refreshBoundary : undefined,
    },
  );
  void payload.allReady.catch(() => undefined);
  return {
    contentType: payload.contentType,
    initialResources: routeAssets,
    metadata: { id: routeId, routeId },
    stream: payload.stream,
  };
}

function uniqueResources(
  input: readonly FigAssetResource[],
): FigAssetResource[] {
  const seen = new Set<string>();
  const result: FigAssetResource[] = [];
  for (const resource of input) {
    const key = assetResourceKey(resource);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(resource);
  }
  return result;
}

function firstServerRouteSegment(
  matches: readonly RouteMatch[],
): { index: number; match: RouteMatch } | undefined {
  const index = matches.findIndex((match) => isServerRoute(match.node.route));
  const match = index === -1 ? undefined : matches[index];
  return match === undefined ? undefined : { index, match };
}

function clientReferencePlaceholder(
  reference: FigClientReference,
  props: Props,
): FigNode {
  if (reference.ssr !== undefined) return createElement(reference.ssr, props);

  return createElement("template", {
    "data-fig-client-reference": reference.id,
  });
}

function serverRouteAssetList(
  matches: readonly RouteMatch[],
  serverRouteAssets:
    | ((metadata: { id: string }) => FigAssetResourceList)
    | undefined,
): FigAssetResource[] {
  if (serverRouteAssets === undefined) return [];
  return matches
    .filter((match) => isServerRoute(match.node.route))
    .flatMap((match) =>
      resourceArray(serverRouteAssets({ id: match.routeId })),
    );
}

function resourceArray(resources: FigAssetResourceList): FigAssetResource[] {
  return isResourceArray(resources) ? [...resources] : [resources];
}

function isResourceArray(
  resources: FigAssetResourceList,
): resources is readonly FigAssetResource[] {
  return Array.isArray(resources);
}

function isPayloadRouteRequest(request: Request): boolean {
  return request.headers.get("accept")?.includes("text/x-fig-payload") === true;
}

function payloadBoundaryHeader(request: Request): string | undefined {
  const value = request.headers.get(PAYLOAD_BOUNDARY_HEADER);
  return value === null || value === "" ? undefined : value;
}

interface DataResourceRequestBody {
  args: PayloadModel[];
  id: string;
}

async function handleDataResourceRequest(
  options: StartHandlerOptions,
  request: Request,
): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const body = await readDataResourceRequestBody(request);
  if (body === null) return jsonResponse({ error: "Invalid request." }, 400);

  const resource = callableStartServerDataResource(
    options.serverDataResources?.[body.id],
  );
  if (resource === null) {
    return jsonResponse({ error: "Unknown data resource." }, 404);
  }

  let key: DataResourceKey;
  const args = body.args.map((arg) => decodePayloadValue(arg));
  try {
    key = resource.key(...args);
    normalizeDataResourceKey(key);
  } catch {
    return jsonResponse({ error: "Invalid data resource key." }, 400);
  }

  try {
    const value = await resource.load(...args, {
      signal: request.signal,
    });
    return jsonResponse({ key, value: encodePayloadValue(value) }, 200);
  } catch {
    return jsonResponse({ error: "Data resource failed." }, 500);
  }
}

function callableStartServerDataResource(
  value: unknown,
): CallableStartServerDataResource | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Partial<CallableStartServerDataResource>;
  return typeof record.key === "function" && typeof record.load === "function"
    ? (record as CallableStartServerDataResource)
    : null;
}

async function readDataResourceRequestBody(
  request: Request,
): Promise<DataResourceRequestBody | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }

  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  return typeof record.id === "string" && Array.isArray(record.args)
    ? { args: record.args, id: record.id }
    : null;
}

function jsonResponse(value: unknown, status: number): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  });
}

function streamPayloadSegmentFrames(
  segment: ServerPayloadSegment,
  nonce: string | undefined,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return streamPayloadSegment(segment, (chunk) =>
    chunk.length === 0
      ? undefined
      : encoder.encode(payloadFrameScript(segment.metadata.id, chunk, nonce)),
  );
}

function streamPayloadSegmentRows(
  segment: ServerPayloadSegment,
): ReadableStream<Uint8Array> {
  return streamPayloadSegment(segment, (_chunk, value) => value);
}

function streamPayloadSegment(
  segment: ServerPayloadSegment,
  emit: (
    chunk: string,
    value: Uint8Array | undefined,
  ) => Uint8Array | undefined,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      reader = segment.stream.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        const chunk =
          done && value === undefined
            ? decoder.decode()
            : decoder.decode(value, { stream: !done });

        const output = emit(chunk, value);
        if (output !== undefined) controller.enqueue(output);

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
}

function renderStreamPrelude(input: {
  hasPayloadSegments: boolean;
  nonce: string | undefined;
}): string {
  return [
    dataStreamBootstrapScript(input.nonce),
    ...(input.hasPayloadSegments
      ? [payloadStreamBootstrapScript(input.nonce)]
      : []),
  ].join("");
}

function renderBootstrap(input: {
  clientEntry: string;
  clientReferenceModules: readonly ClientReferenceModule[];
  dataEntries: readonly PayloadDataHydrationEntry[];
  location: string;
  loaderData: Record<string, unknown>;
  nonce: string | undefined;
  payloadSegments: readonly SerializedPayloadSegment[];
}): string {
  const state: SerializedRouterState = {
    href: input.location,
    loaderData: input.loaderData,
  };
  const nonceAttr =
    input.nonce === undefined ? "" : ` nonce="${escapeAttribute(input.nonce)}"`;

  return [
    `<script id="${ROUTER_STATE_SCRIPT_ID}" type="application/json"${nonceAttr}>${escapeJson(
      state,
    )}</script>`,
    `<script id="${DATA_SCRIPT_ID}" type="application/json"${nonceAttr}>${escapeJson(
      input.dataEntries,
    )}</script>`,
    `<script id="${PAYLOAD_SEGMENTS_SCRIPT_ID}" type="application/json"${nonceAttr}>${escapeJson(
      input.payloadSegments,
    )}</script>`,
    input.clientReferenceModules.length === 0
      ? clientEntryScript(input.clientEntry, nonceAttr)
      : ssrClientReferenceBootstrapScript(
          input.clientEntry,
          input.clientReferenceModules,
          nonceAttr,
        ),
  ].join("");
}

function clientEntryScript(clientEntry: string, nonceAttr: string): string {
  return `<script type="module"${nonceAttr}>import ${escapeJson(
    clientEntry,
  )};</script>`;
}

function ssrClientReferenceBootstrapScript(
  clientEntry: string,
  modules: readonly ClientReferenceModule[],
  nonceAttr: string,
): string {
  const moduleImports = modules.map(
    (entry, index) =>
      `const m${index} = await import(${escapeJson(entry.module)});`,
  );
  const moduleAssignments = modules.map(
    (entry, index) => `registry[${escapeJson(entry.id)}] = m${index};`,
  );
  const lines = [
    ...moduleImports,
    `const registry = globalThis[${escapeJson(CLIENT_REFERENCE_MODULES_GLOBAL)}] ??= {};`,
    ...moduleAssignments,
    `await import(${escapeJson(clientEntry)});`,
  ];

  return `<script type="module"${nonceAttr}>${lines.join("\n")}</script>`;
}

interface DocumentDataStream {
  flush(entries: readonly FigDataHydrationEntry[]): string;
  initial(
    entries: readonly FigDataHydrationEntry[],
  ): PayloadDataHydrationEntry[];
}

function createDocumentDataStream(
  nonce: string | undefined,
): DocumentDataStream {
  const sentKeys = new Set<string>();

  function unsent(
    entries: readonly FigDataHydrationEntry[],
  ): FigDataHydrationEntry[] {
    const next: FigDataHydrationEntry[] = [];
    for (const entry of entries) {
      const key = normalizeDataResourceKey(entry.key);
      if (sentKeys.has(key)) continue;
      sentKeys.add(key);
      next.push(entry);
    }
    return next;
  }

  return {
    flush(entries) {
      const next = unsent(entries);
      return next.length === 0 ? "" : dataFrameScript(next, nonce);
    },
    initial: (entries) => encodePayloadDataEntries(unsent(entries)),
  };
}

const BODY_CLOSE_MARKER = "</body>";
const BODY_CLOSE_HOLDBACK = BODY_CLOSE_MARKER.length - 1;
const BODY_OPEN_MARKER = "<body";
const BODY_OPEN_HOLDBACK = BODY_OPEN_MARKER.length - 1;

interface DocumentStreamInjection {
  afterBodyOpen: () => string;
  beforeBodyClose: () => string;
  beforeHtmlChunk?: () => string;
  companionStreams: readonly ReadableStream<Uint8Array>[];
}

// Initialize streaming queues after <body>, drain ready companion frames beside
// HTML chunks, and keep the client entry at </body> so hydration starts after
// the document stream has produced its root DOM.
function injectDocumentStreams(
  stream: ReadableStream<Uint8Array>,
  injection: DocumentStreamInjection,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const companionStreams = injection.companionStreams.map(
    createBufferedByteStream,
  );
  let bodyPreludeInjected = false;
  let bootstrapInjected = false;
  let buffer = "";
  let htmlReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  function enqueueString(
    controller: ReadableStreamDefaultController<Uint8Array>,
    value: string,
  ): void {
    if (value.length > 0) controller.enqueue(encoder.encode(value));
  }

  function enqueueGenerated(
    controller: ReadableStreamDefaultController<Uint8Array>,
    callback: (() => string) | undefined,
  ): void {
    enqueueString(controller, callback?.() ?? "");
  }

  function flushLive(
    controller: ReadableStreamDefaultController<Uint8Array>,
  ): void {
    enqueueGenerated(controller, injection.beforeHtmlChunk);
    for (const item of companionStreams) item.flush(controller);
  }

  function injectBodyPrelude(
    controller: ReadableStreamDefaultController<Uint8Array>,
  ): void {
    if (bodyPreludeInjected) return;
    bodyPreludeInjected = true;
    enqueueGenerated(controller, injection.afterBodyOpen);
    flushLive(controller);
  }

  function enqueueBufferedPrefix(
    controller: ReadableStreamDefaultController<Uint8Array>,
    length: number,
  ): void {
    enqueueString(controller, buffer.slice(0, length));
    buffer = buffer.slice(length);
  }

  function enqueueSafeBufferedPrefix(
    controller: ReadableStreamDefaultController<Uint8Array>,
    holdback: number,
    final: boolean,
  ): void {
    enqueueBufferedPrefix(
      controller,
      final ? buffer.length : Math.max(0, buffer.length - holdback),
    );
  }

  function processBeforeBodyPrelude(
    controller: ReadableStreamDefaultController<Uint8Array>,
    final: boolean,
  ): void {
    if (bodyPreludeInjected) return;

    const bodyStart = buffer.toLowerCase().indexOf(BODY_OPEN_MARKER);
    if (bodyStart === -1) {
      enqueueSafeBufferedPrefix(controller, BODY_OPEN_HOLDBACK, final);
      if (final) injectBodyPrelude(controller);
      return;
    }

    const bodyEnd = buffer.indexOf(">", bodyStart);
    if (bodyEnd === -1) {
      enqueueBufferedPrefix(controller, bodyStart);
      return;
    }

    enqueueBufferedPrefix(controller, bodyEnd + 1);
    injectBodyPrelude(controller);
  }

  async function closeLive(
    controller: ReadableStreamDefaultController<Uint8Array>,
  ): Promise<void> {
    flushLive(controller);
    for (const item of companionStreams) {
      await item.close(controller);
    }
  }

  async function processAfterBodyPrelude(
    controller: ReadableStreamDefaultController<Uint8Array>,
    final: boolean,
  ): Promise<void> {
    if (!bodyPreludeInjected || bootstrapInjected) return;

    const bodyCloseIndex = buffer.indexOf(BODY_CLOSE_MARKER);
    if (bodyCloseIndex !== -1) {
      enqueueBufferedPrefix(controller, bodyCloseIndex);
      // Companion frames enqueued before </body> must beat the bootstrap
      // script regardless of HTML chunk granularity; their buffered readers
      // pull asynchronously, so give those reads one tick to settle.
      await settleCompanionReads();
      flushLive(controller);
      enqueueGenerated(controller, injection.beforeBodyClose);
      bootstrapInjected = true;
      await closeLive(controller);
      enqueueBufferedPrefix(controller, buffer.length);
      return;
    }

    flushLive(controller);
    enqueueSafeBufferedPrefix(controller, BODY_CLOSE_HOLDBACK, final);

    if (final) {
      await settleCompanionReads();
      flushLive(controller);
      enqueueGenerated(controller, injection.beforeBodyClose);
      bootstrapInjected = true;
      await closeLive(controller);
    }
  }

  function settleCompanionReads(): Promise<void> {
    if (companionStreams.length === 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  function processAfterBootstrap(
    controller: ReadableStreamDefaultController<Uint8Array>,
  ): void {
    if (!bootstrapInjected) return;
    flushLive(controller);
    enqueueString(controller, buffer);
    buffer = "";
  }

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      htmlReader = stream.getReader();

      for (;;) {
        const { done, value } = await htmlReader.read();
        if (done) {
          buffer += decoder.decode();
          processBeforeBodyPrelude(controller, true);
          await processAfterBodyPrelude(controller, true);
          processAfterBootstrap(controller);
          controller.close();
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        processBeforeBodyPrelude(controller, false);
        await processAfterBodyPrelude(controller, false);
        processAfterBootstrap(controller);
      }
    },
    cancel(reason) {
      void htmlReader?.cancel(reason).catch(() => undefined);
      for (const item of companionStreams) item.cancel(reason);
    },
  });
}

interface BufferedByteStream {
  cancel(reason: unknown): void;
  close(controller: ReadableStreamDefaultController<Uint8Array>): Promise<void>;
  flush(controller: ReadableStreamDefaultController<Uint8Array>): void;
}

function createBufferedByteStream(
  stream: ReadableStream<Uint8Array>,
): BufferedByteStream {
  const chunks: Uint8Array[] = [];
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let failure: unknown;
  const done = (async () => {
    reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      chunks.push(value);
    }
  })().catch((error: unknown) => {
    failure = error;
  });

  function flush(
    controller: ReadableStreamDefaultController<Uint8Array>,
  ): void {
    for (;;) {
      const chunk = chunks.shift();
      if (chunk === undefined) return;
      controller.enqueue(chunk);
    }
  }

  return {
    cancel(reason) {
      void reader?.cancel(reason).catch(() => undefined);
    },
    async close(controller) {
      await done;
      flush(controller);
      if (failure !== undefined) throw failure;
    },
    flush,
  };
}

function dataStreamBootstrapScript(nonce: string | undefined): string {
  const nonceAttr =
    nonce === undefined ? "" : ` nonce="${escapeAttribute(nonce)}"`;
  return `<script${nonceAttr}>(function(){var g=globalThis;var r=g.${DATA_STREAM_GLOBAL};if(r)return;var q=[];var l=[];g.${DATA_STREAM_GLOBAL}={q:q,p:function(e){for(var i=0;i<e.length;i++)q.push(e[i]);for(var j=0;j<l.length;j++)l[j](e)},s:function(fn){l.push(fn);if(q.length>0)fn(q);return function(){var n=[];for(var k=0;k<l.length;k++)if(l[k]!==fn)n.push(l[k]);l=n}}};})();</script>`;
}

function dataFrameScript(
  entries: readonly FigDataHydrationEntry[],
  nonce: string | undefined,
): string {
  const nonceAttr =
    nonce === undefined ? "" : ` nonce="${escapeAttribute(nonce)}"`;
  return (
    `<script type="application/json" ${DATA_FRAME_ATTR}=""${nonceAttr}>${escapeJson(
      encodePayloadDataEntries(entries),
    )}</script>` +
    `<script${nonceAttr}>globalThis.${DATA_STREAM_GLOBAL}.p(JSON.parse(document.currentScript.previousElementSibling.textContent));</script>`
  );
}

function payloadStreamBootstrapScript(nonce: string | undefined): string {
  const nonceAttr =
    nonce === undefined ? "" : ` nonce="${escapeAttribute(nonce)}"`;
  return `<script${nonceAttr}>(function(){var g=globalThis;var r=g.${PAYLOAD_STREAM_GLOBAL};if(r)return;var q=[];var l=[];g.${PAYLOAD_STREAM_GLOBAL}={q:q,p:function(f){q.push(f);for(var i=0;i<l.length;i++)l[i](f)},s:function(fn){l.push(fn);for(var i=0;i<q.length;i++)fn(q[i]);return function(){var n=[];for(var j=0;j<l.length;j++)if(l[j]!==fn)n.push(l[j]);l=n}}};})();</script>`;
}

function payloadFrameScript(
  segmentId: string,
  chunk: string,
  nonce: string | undefined,
): string {
  const nonceAttr =
    nonce === undefined ? "" : ` nonce="${escapeAttribute(nonce)}"`;
  const frame: SerializedPayloadFrame = { chunk, id: segmentId };
  return (
    `<script type="application/json" ${PAYLOAD_FRAME_ATTR}=""${nonceAttr}>${escapeJson(
      frame,
    )}</script>` +
    `<script${nonceAttr}>globalThis.${PAYLOAD_STREAM_GLOBAL}.p(JSON.parse(document.currentScript.previousElementSibling.textContent));</script>`
  );
}

function shellErrorHtml(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `<!doctype html><html lang="en"><body><pre>${escapeText(
    message,
  )}</pre></body></html>`;
}

function escapeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003C");
}
