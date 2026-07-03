import {
  createElement,
  type FigClientReference,
  type FigNode,
  type FigAssetResource,
  type FigAssetResourceList,
  Fragment,
  assets,
  type Props,
} from "@bgub/fig";
import {
  assetResourceKey,
  type FigDataHydrationEntry,
} from "@bgub/fig/internal";
import { normalizeDataResourceKey } from "@bgub/fig-data/internal";
import { renderToDocumentStream } from "@bgub/fig-server";
import {
  createRscResponse,
  RscBoundary,
  type RscClientReferenceRecord,
  renderToRscStream,
} from "@bgub/fig-server/rsc";
import type { Server } from "node:http";
import {
  DATA_SCRIPT_ID,
  DATA_FRAME_ATTR,
  DATA_STREAM_GLOBAL,
  RSC_BOUNDARY_HEADER,
  RSC_FRAME_ATTR,
  RSC_ROUTE_ID_HEADER,
  RSC_SEGMENT_ID_HEADER,
  ROOT_ELEMENT_ID,
  RSC_SEGMENTS_SCRIPT_ID,
  RSC_STREAM_GLOBAL,
  CLIENT_REFERENCE_MODULES_GLOBAL,
  ROUTER_STATE_SCRIPT_ID,
  type SerializedRscFrame,
  type SerializedRscSegment,
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
import {
  runStartRuntime,
  startRuntimeLayer,
} from "./server-runtime/runtime.ts";

export {
  StartCloseError,
  StartConfigError,
  StartListenError,
} from "./server-runtime/errors.ts";

export interface StartHandlerOptions {
  assets?: Record<string, StartStaticAssetInput>;
  clientReferenceAssets?: (metadata: { id: string }) => FigAssetResourceList;
  // URL of the built client entry module, as served (e.g. "/client.js").
  clientEntry: string;
  // Per-request context for beforeLoad/loader (e.g. a data/query client). May
  // return a promise; it is awaited before routing.
  context?: (request: Request) => unknown;
  // Per-request context passed to Fig data resources during server render.
  dataContext?: (request: Request) => unknown;
  // Extra <head> content (e.g. <title>, <meta>). fig-server lowers host
  // title/meta/link into hoisted document resources.
  head?: FigNode;
  htmlLang?: string;
  nonce?: (request: Request) => string;
  routes: readonly AnyRoute[];
  serverRouteAssets?: (metadata: { id: string }) => FigAssetResourceList;
}

export type StartHandler = (request: Request) => Promise<Response>;

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
    // Build the per-request data context once and share it across both the RSC
    // render and the document render (a side-effecting factory must run once).
    const dataContext = options.dataContext?.(request);

    const isRscRequest = isRscRouteRequest(request);
    const refreshBoundary = isRscRequest
      ? rscBoundaryHeader(request)
      : undefined;
    // A `.server.tsx` route segment renders through the RSC stream. The document
    // render can stream server-renderable HTML into the same slot, then the client
    // mounts and refreshes the RSC payload for that segment.
    const rscSegment = renderServerRouteSegment(
      result,
      router,
      dataContext,
      options.clientReferenceAssets,
      options.serverRouteAssets,
      refreshBoundary,
    );

    if (isRscRequest) {
      if (rscSegment === undefined) {
        return new Response("No RSC segment for route.", { status: 404 });
      }
      if (
        refreshBoundary !== undefined &&
        refreshBoundary !== rscSegment.metadata.routeId
      ) {
        return new Response("RSC boundary does not match the route segment.", {
          status: 400,
        });
      }

      return new Response(streamRscSegmentRows(rscSegment), {
        headers: {
          "content-type": rscSegment.contentType,
          [RSC_ROUTE_ID_HEADER]: rscSegment.metadata.routeId,
          [RSC_SEGMENT_ID_HEADER]: rscSegment.metadata.id,
        },
        status,
      });
    }

    const documentRsc =
      rscSegment === undefined
        ? undefined
        : createDocumentRscSegment(rscSegment);
    await documentRsc?.initialRootReady;
    const hoistedServerRouteResources = uniqueResources([
      ...(rscSegment?.initialResources ?? []),
      ...(documentRsc?.assetResources() ?? []),
    ]);
    const routerTree = createElement(
      ServerRouteRenderProvider,
      { mode: "document" },
      createElement(RouterProvider, { router }),
    );
    const appTree =
      documentRsc === undefined
        ? routerTree
        : createElement(
            ServerRouteContentProvider,
            { store: documentRsc.store },
            routerTree,
          );
    const document = createElement(
      "html",
      { lang: options.htmlLang ?? "en" },
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
      dataContext,
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

    const rscSegments = rscSegment === undefined ? [] : [rscSegment.metadata];
    const rscFrameStream =
      documentRsc === undefined
        ? undefined
        : streamRscSegmentFrames(documentRsc.frames, nonce);
    const dataStream = createDocumentDataStream(nonce);
    const clientReferenceModules =
      documentRsc === undefined
        ? []
        : initialClientReferenceModules(documentRsc.clientReferences());

    return new Response(
      injectDocumentStreams(render.stream, {
        afterBodyOpen: () =>
          renderStreamPrelude({
            hasRscSegments: rscSegments.length > 0,
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
            rscSegments,
          }),
        beforeHtmlChunk: () => dataStream.flush(render.getData()),
        companionStreams: rscFrameStream === undefined ? [] : [rscFrameStream],
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

  return runStartRuntime(
    startRuntimeLayer({
      config: { appUrl, cacheClientAssets, clientEntry, mode, port, publicUrl },
      handlerOptions,
      log: console.log,
    }),
  );
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

interface ServerRscSegment {
  contentType: string;
  initialResources: readonly FigAssetResource[];
  metadata: SerializedRscSegment;
  stream: ReadableStream<Uint8Array>;
}

interface DocumentRscSegment {
  assetResources(): readonly FigAssetResource[];
  clientReferences(): readonly RscClientReferenceRecord[];
  frames: ServerRscSegment;
  initialRootReady: Promise<void>;
  store: ServerRouteContentStore;
}

interface ClientReferenceModule {
  id: string;
  module: string;
}

function createDocumentRscSegment(
  segment: ServerRscSegment,
): DocumentRscSegment {
  const [decodeStream, frameStream] = segment.stream.tee();
  const response = createRscResponse({
    resolveClientReference: (metadata) =>
      metadata.ssr === true
        ? resolveServerClientReference(metadata)
        : undefined,
  });
  const initialRootReady = decodeDocumentRscStream(response, decodeStream);

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

function decodeDocumentRscStream(
  response: ReturnType<typeof createRscResponse>,
  stream: ReadableStream<Uint8Array>,
): Promise<void> {
  const decoder = new TextDecoder();
  let bufferedRows = "";
  let resolveInitialRoot: () => void = () => undefined;
  let initialRootSettled = false;
  const initialRootReady = new Promise<void>((resolve) => {
    resolveInitialRoot = resolve;
  });

  function settleInitialRoot(): void {
    if (initialRootSettled) return;
    initialRootSettled = true;
    resolveInitialRoot();
  }

  function processRows(chunk: string, done: boolean): void {
    bufferedRows += chunk;
    const rows = bufferedRows.split("\n");
    bufferedRows = rows.pop() ?? "";

    for (const row of rows) {
      if (isRootModelRow(row)) settleInitialRoot();
    }
    if (done) {
      if (isRootModelRow(bufferedRows)) settleInitialRoot();
      bufferedRows = "";
      settleInitialRoot();
    }
  }

  async function decode(): Promise<void> {
    const reader = stream.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        const chunk =
          done && value === undefined
            ? decoder.decode()
            : decoder.decode(value, { stream: !done });
        if (chunk.length > 0 || done) processRows(chunk, done);
        if (chunk.length > 0) response.processStringChunk(chunk);
        if (done) {
          response.processStringChunk("\n");
          return;
        }
      }
    } catch {
      settleInitialRoot();
    }
  }

  void decode();

  return Promise.race([
    initialRootReady,
    new Promise<void>((resolve) => setTimeout(resolve, 0)),
  ]);
}

function isRootModelRow(line: string): boolean {
  if (line.length === 0) return false;
  try {
    const row = JSON.parse(line) as { id?: unknown; tag?: unknown };
    return row.id === 0 && row.tag === "model";
  } catch {
    return false;
  }
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
  references: readonly RscClientReferenceRecord[],
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
  dataContext: unknown,
  clientReferenceAssets:
    | ((metadata: { id: string }) => FigAssetResourceList)
    | undefined,
  serverRouteAssets:
    | ((metadata: { id: string }) => FigAssetResourceList)
    | undefined,
  refreshBoundary: string | undefined,
): ServerRscSegment | undefined {
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
  const rsc = renderToRscStream(
    createElement(
      Fragment,
      null,
      refreshesSegment
        ? routeContent
        : createElement(RscBoundary, { id: routeId }, routeContent),
    ),
    {
      clientReferenceAssets,
      dataContext,
      refreshBoundary: refreshesSegment ? refreshBoundary : undefined,
    },
  );
  void rsc.allReady.catch(() => undefined);
  return {
    contentType: rsc.contentType,
    initialResources: routeAssets,
    metadata: { id: routeId, routeId },
    stream: rsc.stream,
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

function isRscRouteRequest(request: Request): boolean {
  return request.headers.get("accept")?.includes("text/x-component") === true;
}

function rscBoundaryHeader(request: Request): string | undefined {
  const value = request.headers.get(RSC_BOUNDARY_HEADER);
  return value === null || value === "" ? undefined : value;
}

// A throw inside a server component becomes an RSC "error" row (it doesn't reject
// allReady), so the request would otherwise return 200 with no server log. Surface
// it; the client error boundary renders it on its side.
function reportServerRouteError(routeId: string, line: string): void {
  const message = rscErrorMessage(line);
  if (message === null) return;
  console.error(
    `[fig-start] server route "${routeId}" failed to render: ${message}`,
  );
}

function rscErrorMessage(line: string): string | null {
  let row: unknown;
  try {
    row = JSON.parse(line);
  } catch {
    return null;
  }

  if (!isRecord(row) || row.tag !== "error") return null;
  const value = row.value;
  return isRecord(value) && typeof value.message === "string"
    ? value.message
    : "unknown error";
}

function streamRscSegmentFrames(
  segment: ServerRscSegment,
  nonce: string | undefined,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return streamRscSegment(segment, (chunk) =>
    chunk.length === 0
      ? undefined
      : encoder.encode(rscFrameScript(segment.metadata.id, chunk, nonce)),
  );
}

function streamRscSegmentRows(
  segment: ServerRscSegment,
): ReadableStream<Uint8Array> {
  return streamRscSegment(segment, (_chunk, value) => value);
}

function streamRscSegment(
  segment: ServerRscSegment,
  emit: (
    chunk: string,
    value: Uint8Array | undefined,
  ) => Uint8Array | undefined,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const reportErrors = createRscErrorReporter(segment.metadata.routeId);
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

        if (chunk.length > 0 || done) {
          reportErrors(chunk, done);
        }

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

function createRscErrorReporter(
  routeId: string,
): (chunk: string, done: boolean) => void {
  let bufferedLine = "";

  return (chunk, done) => {
    bufferedLine += chunk;
    const lines = bufferedLine.split("\n");
    bufferedLine = lines.pop() ?? "";

    for (const line of lines) reportServerRouteErrorLine(routeId, line);
    if (done) {
      reportServerRouteErrorLine(routeId, bufferedLine);
      bufferedLine = "";
    }
  };

  function reportServerRouteErrorLine(routeId: string, line: string): void {
    if (line.length > 0) reportServerRouteError(routeId, line);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function renderStreamPrelude(input: {
  hasRscSegments: boolean;
  nonce: string | undefined;
}): string {
  return [
    dataStreamBootstrapScript(input.nonce),
    ...(input.hasRscSegments ? [rscStreamBootstrapScript(input.nonce)] : []),
  ].join("");
}

function renderBootstrap(input: {
  clientEntry: string;
  clientReferenceModules: readonly ClientReferenceModule[];
  dataEntries: readonly FigDataHydrationEntry[];
  location: string;
  loaderData: Record<string, unknown>;
  nonce: string | undefined;
  rscSegments: readonly SerializedRscSegment[];
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
    `<script id="${RSC_SEGMENTS_SCRIPT_ID}" type="application/json"${nonceAttr}>${escapeJson(
      input.rscSegments,
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
  initial(entries: readonly FigDataHydrationEntry[]): FigDataHydrationEntry[];
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
    initial: unsent,
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
      flushLive(controller);
      enqueueBufferedPrefix(controller, bodyCloseIndex);
      enqueueGenerated(controller, injection.beforeBodyClose);
      bootstrapInjected = true;
      await closeLive(controller);
      enqueueBufferedPrefix(controller, buffer.length);
      return;
    }

    flushLive(controller);
    enqueueSafeBufferedPrefix(controller, BODY_CLOSE_HOLDBACK, final);

    if (final) {
      enqueueGenerated(controller, injection.beforeBodyClose);
      bootstrapInjected = true;
      await closeLive(controller);
    }
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
      entries,
    )}</script>` +
    `<script${nonceAttr}>globalThis.${DATA_STREAM_GLOBAL}.p(JSON.parse(document.currentScript.previousElementSibling.textContent));</script>`
  );
}

function rscStreamBootstrapScript(nonce: string | undefined): string {
  const nonceAttr =
    nonce === undefined ? "" : ` nonce="${escapeAttribute(nonce)}"`;
  return `<script${nonceAttr}>(function(){var g=globalThis;var r=g.${RSC_STREAM_GLOBAL};if(r)return;var q=[];var l=[];g.${RSC_STREAM_GLOBAL}={q:q,p:function(f){q.push(f);for(var i=0;i<l.length;i++)l[i](f)},s:function(fn){l.push(fn);for(var i=0;i<q.length;i++)fn(q[i]);return function(){var n=[];for(var j=0;j<l.length;j++)if(l[j]!==fn)n.push(l[j]);l=n}}};})();</script>`;
}

function rscFrameScript(
  segmentId: string,
  chunk: string,
  nonce: string | undefined,
): string {
  const nonceAttr =
    nonce === undefined ? "" : ` nonce="${escapeAttribute(nonce)}"`;
  const frame: SerializedRscFrame = { chunk, id: segmentId };
  return (
    `<script type="application/json" ${RSC_FRAME_ATTR}=""${nonceAttr}>${escapeJson(
      frame,
    )}</script>` +
    `<script${nonceAttr}>globalThis.${RSC_STREAM_GLOBAL}.p(JSON.parse(document.currentScript.previousElementSibling.textContent));</script>`
  );
}

function shellErrorHtml(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `<!doctype html><html lang="en"><body><pre>${escapeText(
    message,
  )}</pre></body></html>`;
}

function escapeText(value: string): string {
  return value.replace(/[&<>]/g, (character) =>
    character === "&" ? "&amp;" : character === "<" ? "&lt;" : "&gt;",
  );
}

function escapeAttribute(value: string): string {
  return value.replace(/[&"<>]/g, (character) =>
    character === "&"
      ? "&amp;"
      : character === '"'
        ? "&quot;"
        : character === "<"
          ? "&lt;"
          : "&gt;",
  );
}

function escapeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003C");
}
