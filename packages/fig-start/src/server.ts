import {
  createElement,
  type ElementType,
  type FigNode,
  type FigResourceList,
  Fragment,
  resources,
} from "@bgub/fig";
import type { FigDataHydrationEntry } from "@bgub/fig/internal";
import { renderToDocumentStream } from "@bgub/fig-server";
import { renderToRscStream } from "@bgub/fig-server/rsc";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import {
  DATA_SCRIPT_ID,
  RSC_FRAME_ATTR,
  RSC_ROUTE_ID_HEADER,
  RSC_SEGMENT_ID_HEADER,
  ROOT_ELEMENT_ID,
  RSC_SEGMENTS_SCRIPT_ID,
  RSC_STREAM_GLOBAL,
  ROUTER_STATE_SCRIPT_ID,
  type SerializedRscFrame,
  type SerializedRscSegment,
  type SerializedRouterState,
} from "./bootstrap.ts";
import { RouterProvider } from "./components.tsx";
import type { Router } from "./core.ts";
import { isServerRoute } from "./internal.ts";
import type { LoadResult } from "./router.ts";
import { createRouter } from "./router.ts";
import { RouterContext } from "./router-context.ts";
import type { AnyRoute } from "./route.ts";
import {
  type ClientAssetResolver,
  createClientAssetResolver,
  requestPathname,
} from "./server-assets.ts";

export interface StartHandlerOptions {
  assets?: Record<string, StartStaticAssetInput>;
  clientReferenceAssets?: (metadata: { id: string }) => FigResourceList;
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
  serverRouteAssets?: (metadata: { id: string }) => FigResourceList;
}

export type StartHandler = (request: Request) => Promise<Response>;

// Web-standard request handler (use directly on edge runtimes or in tests).
// Most apps use startServer() instead.
export function createRequestHandler(
  options: StartHandlerOptions,
): StartHandler {
  const assets = normalizeStaticAssets(options.assets);

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const asset = assets.get(url.pathname);
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

    // A `.server.tsx` leaf renders through the RSC stream; the SSR tree leaves an
    // empty slot for that segment, and row chunks stream into it as inline frames.
    const rscSegment = renderServerRouteSegment(
      result,
      router,
      dataContext,
      options.clientReferenceAssets,
      options.serverRouteAssets,
    );

    if (isRscRouteRequest(request)) {
      if (rscSegment === undefined) {
        return new Response("No RSC segment for route.", { status: 404 });
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
        options.head ?? null,
      ),
      createElement(
        "body",
        null,
        createElement(
          "div",
          { id: ROOT_ELEMENT_ID },
          createElement(RouterProvider, { router }),
        ),
      ),
    );

    const render = renderToDocumentStream(document, {
      dataContext,
      nonce,
      onError: () => ({ digest: "fig-start-error" }),
    });

    try {
      // Await all work (not just the shell) so data resources resolved behind
      // Suspense are captured in the hydration snapshot below. Progressive
      // streaming-data hydration is a planned follow-up; M1 buffers the
      // document so the client hydrates with complete data and never refetches.
      await render.allReady;
    } catch (error) {
      return new Response(shellErrorHtml(error), {
        headers: { "content-type": "text/html; charset=utf-8" },
        status: 500,
      });
    }

    const rscSegments = rscSegment === undefined ? [] : [rscSegment.metadata];
    const rscFrameStream =
      rscSegment === undefined
        ? undefined
        : streamRscSegmentFrames(rscSegment, nonce);

    const bootstrap = renderBootstrap({
      clientEntry: options.clientEntry,
      dataEntries: render.getData(),
      location: location.href,
      loaderData: collectLoaderData(result),
      nonce,
      rscSegments,
    });

    return new Response(
      injectBeforeBodyClose(render.stream, bootstrap, rscFrameStream),
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
  clientEntry?: string;
  port?: number;
}

export interface StartStaticAsset {
  content: string | Uint8Array;
  contentType?: string;
}

export type StartStaticAssetInput = string | Uint8Array | StartStaticAsset;

// The batteries-included entry: builds the request handler, serves built client
// assets, handles status codes and headers, and listens. An app's server entry
// is just `startServer({ routes, appUrl: import.meta.url, ... })`.
export function startServer(options: StartServerOptions): Server {
  const clientEntry = options.clientEntry ?? "/client.js";
  const cacheClientAssets = process.env.NODE_ENV === "production";
  const clientAssets = createClientAssetResolver({
    appUrl: options.appUrl,
    cache: cacheClientAssets,
    clientEntry,
  });
  const handler = createRequestHandler({ ...options, clientEntry });
  const listener = nodeListener(handler);

  const server = createServer((request, response) => {
    const url = request.url ?? "/";

    void serveClientAssetOrRoute(
      clientAssets,
      url,
      request,
      response,
      listener,
      cacheClientAssets,
    );
  });

  const port = options.port ?? Number(process.env.PORT ?? 3000);
  server.listen(port, () => {
    console.log(`Fig Start: http://localhost:${port}/`);
  });
  return server;
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

function contentTypeFor(pathname: string): string {
  if (pathname.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
  if (pathname.endsWith(".svg")) return "image/svg+xml";
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg"))
    return "image/jpeg";
  if (pathname.endsWith(".webp")) return "image/webp";
  if (pathname.endsWith(".avif")) return "image/avif";
  if (pathname.endsWith(".woff2")) return "font/woff2";
  return "application/octet-stream";
}

async function serveClientAssetOrRoute(
  clientAssets: ClientAssetResolver,
  url: string,
  request: NodeRequestLike,
  response: NodeResponseLike,
  listener: (request: NodeRequestLike, response: NodeResponseLike) => void,
  cacheClientAssets: boolean,
): Promise<void> {
  let assetUrl: URL | null;
  try {
    assetUrl = await clientAssets.resolve(url);
  } catch {
    listener(request, response);
    return;
  }

  if (assetUrl !== null) {
    await serveClientAsset(assetUrl, response, cacheClientAssets);
    return;
  }

  if (requestPathname(url) === "/favicon.ico") {
    response.writeHead(204);
    response.end();
    return;
  }

  listener(request, response);
}

interface NodeRequestLike {
  headers: Record<string, string | string[] | undefined>;
  method?: string;
  url?: string;
}

interface NodeResponseLike {
  end(chunk?: Uint8Array | string): void;
  setHeader(name: string, value: string): void;
  statusCode: number;
  write(chunk: Uint8Array | string): void;
  writeHead(status: number, headers?: Record<string, string>): void;
}

function nodeListener(
  handler: StartHandler,
): (request: NodeRequestLike, response: NodeResponseLike) => void {
  return (request, response) => {
    void run();

    async function run(): Promise<void> {
      const host = headerValue(request.headers.host) ?? "localhost";
      const webRequest = new Request(`http://${host}${request.url ?? "/"}`, {
        headers: toWebHeaders(request.headers),
        method: request.method ?? "GET",
      });

      const result = await handler(webRequest);
      response.statusCode = result.status;
      result.headers.forEach((value, name) => response.setHeader(name, value));

      if (result.body === null) {
        response.end();
        return;
      }

      const reader = result.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        response.write(value);
      }
      response.end();
    }
  };
}

async function serveClientAsset(
  url: URL,
  response: NodeResponseLike,
  cache: boolean,
): Promise<void> {
  try {
    const code = await readFile(url);
    response.writeHead(200, {
      "cache-control": cache ? "public, max-age=31536000, immutable" : "no-store",
      "content-type": contentTypeFor(url.pathname),
    });
    response.end(code);
  } catch {
    response.writeHead(404);
    response.end("client bundle not built");
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function toWebHeaders(
  headers: Record<string, string | string[] | undefined>,
): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) result.append(name, item);
    } else {
      result.set(name, value);
    }
  }
  return result;
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
  metadata: SerializedRscSegment;
  stream: ReadableStream<Uint8Array>;
}

function renderServerRouteSegment(
  result: LoadResult,
  router: Router,
  dataContext: unknown,
  clientReferenceAssets:
    | ((metadata: { id: string }) => FigResourceList)
    | undefined,
  serverRouteAssets:
    | ((metadata: { id: string }) => FigResourceList)
    | undefined,
): ServerRscSegment | undefined {
  if (result.status !== "match") return undefined;
  const leaf = result.matches[result.matches.length - 1];
  if (leaf === undefined || !isServerRoute(leaf.node.route)) {
    return undefined;
  }

  const Component = leaf.node.route.options.component;
  if (Component === undefined) return undefined;

  // Server route components receive { params, loaderData } as props and the
  // same router context as the document render, so typed route hooks work in
  // both isomorphic and server-route leaves.
  const routeAssets = serverRouteAssets?.({ id: leaf.routeId });
  const routeNode = createElement(
    RouterContext,
    { value: router },
    createElement(Component as ElementType, {
      loaderData: leaf.loaderData,
      params: leaf.params,
    }),
  );
  const rsc = renderToRscStream(
    createElement(
      Fragment,
      null,
      routeAssets === undefined ? routeNode : resources(routeAssets, routeNode),
    ),
    { clientReferenceAssets, dataContext },
  );
  void rsc.allReady.catch(() => undefined);
  return {
    contentType: rsc.contentType,
    metadata: { id: leaf.routeId, routeId: leaf.routeId },
    stream: rsc.stream,
  };
}

function isRscRouteRequest(request: Request): boolean {
  return request.headers.get("accept")?.includes("text/x-component") === true;
}

// A throw inside a server component becomes an RSC "error" row (it doesn't reject
// allReady), so the request would otherwise return 200 with no server log. Surface
// it; the client error boundary renders it on its side.
function reportServerRouteError(routeId: string, line: string): void {
  let row: { tag?: string; value?: { message?: string } };
  try {
    row = JSON.parse(line) as typeof row;
  } catch {
    return;
  }
  if (row.tag !== "error") return;
  console.error(
    `[fig-start] server route "${routeId}" failed to render: ${
      row.value?.message ?? "unknown error"
    }`,
  );
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
    if (line.length > 0 && line.includes('"tag":"error"')) {
      reportServerRouteError(routeId, line);
    }
  }
}

function renderBootstrap(input: {
  clientEntry: string;
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
    ...(input.rscSegments.length === 0
      ? []
      : [rscStreamBootstrapScript(input.nonce)]),
    `<script id="${ROUTER_STATE_SCRIPT_ID}" type="application/json"${nonceAttr}>${escapeJson(
      state,
    )}</script>`,
    `<script id="${DATA_SCRIPT_ID}" type="application/json"${nonceAttr}>${escapeJson(
      input.dataEntries,
    )}</script>`,
    `<script id="${RSC_SEGMENTS_SCRIPT_ID}" type="application/json"${nonceAttr}>${escapeJson(
      input.rscSegments,
    )}</script>`,
    `<script${nonceAttr}>import(${escapeJson(input.clientEntry)});</script>`,
  ].join("");
}

// Inject the bootstrap right before the document's </body> so the client entry
// and hydration data load with the shell.
function injectBeforeBodyClose(
  stream: ReadableStream<Uint8Array>,
  html: string,
  beforeBodyClose?: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const marker = "</body>";
  let injected = false;
  let buffer = "";

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = stream.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          if (buffer.length > 0) controller.enqueue(encoder.encode(buffer));
          if (!injected) {
            controller.enqueue(encoder.encode(html));
            if (beforeBodyClose !== undefined) {
              await pipeStream(beforeBodyClose, controller);
            }
          }
          controller.close();
          return;
        }

        if (injected) {
          controller.enqueue(value);
          continue;
        }

        buffer += decoder.decode(value, { stream: true });
        const index = buffer.indexOf(marker);
        if (index === -1) {
          // Hold back a marker-length tail in case </body> spans two chunks.
          const safe = buffer.slice(
            0,
            Math.max(0, buffer.length - marker.length),
          );
          if (safe.length > 0) {
            controller.enqueue(encoder.encode(safe));
            buffer = buffer.slice(safe.length);
          }
          continue;
        }

        controller.enqueue(encoder.encode(buffer.slice(0, index) + html));
        if (beforeBodyClose !== undefined) {
          await pipeStream(beforeBodyClose, controller);
        }
        controller.enqueue(encoder.encode(buffer.slice(index)));
        injected = true;
        buffer = "";
      }
    },
  });
}

async function pipeStream(
  stream: ReadableStream<Uint8Array>,
  controller: ReadableStreamDefaultController<Uint8Array>,
): Promise<void> {
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    controller.enqueue(value);
  }
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
