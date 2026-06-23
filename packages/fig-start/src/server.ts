import {
  createElement,
  type ElementType,
  type FigNode,
  Fragment,
} from "@bgub/fig";
import type { FigDataHydrationEntry } from "@bgub/fig/internal";
import { renderToDocumentStream } from "@bgub/fig-server";
import { renderToRscStream } from "@bgub/fig-server/rsc";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import {
  DATA_SCRIPT_ID,
  ROOT_ELEMENT_ID,
  RSC_PAYLOAD_SCRIPT_ID,
  ROUTER_STATE_SCRIPT_ID,
  type SerializedRscPayload,
  type SerializedRouterState,
} from "./bootstrap.ts";
import { RouterProvider } from "./components.tsx";
import type { LoadResult } from "./router.ts";
import { createRouter } from "./router.ts";
import type { AnyRoute } from "./route.ts";

export interface StartHandlerOptions {
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
}

export type StartHandler = (request: Request) => Promise<Response>;

// Web-standard request handler (use directly on edge runtimes or in tests).
// Most apps use startServer() instead.
export function createRequestHandler(
  options: StartHandlerOptions,
): StartHandler {
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
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

    // A `.server.tsx` leaf renders through the RSC stream; its payload is inlined
    // on the document and the SSR tree leaves an empty slot for it.
    const rscPayload = await renderServerRoutePayload(result, dataContext);

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

    const bootstrap = renderBootstrap({
      clientEntry: options.clientEntry,
      dataEntries: render.getData(),
      location: location.href,
      loaderData: collectLoaderData(result),
      nonce,
      rsc: rscPayload,
    });

    return new Response(injectBeforeBodyClose(render.stream, bootstrap), {
      headers: { "content-type": render.contentType },
      status,
    });
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
  // CSS served at /style.css and linked into <head> automatically.
  styles?: string;
}

// The batteries-included entry: builds the request handler, serves the client
// bundle and stylesheet, handles status codes and headers, and listens. An app's
// server entry is just `startServer({ routes, appUrl: import.meta.url, ... })`.
export function startServer(options: StartServerOptions): Server {
  const clientEntry = options.clientEntry ?? "/client.js";
  const stylePath = "/style.css";
  const clientUrl = new URL("./client.js", options.appUrl);

  const head =
    options.styles === undefined
      ? options.head
      : createElement(
          Fragment,
          null,
          createElement("link", { href: stylePath, rel: "stylesheet" }),
          options.head ?? null,
        );

  const handler = createRequestHandler({ ...options, clientEntry, head });
  const listener = nodeListener(handler);

  const server = createServer((request, response) => {
    const url = request.url ?? "/";

    if (options.styles !== undefined && url === stylePath) {
      response.writeHead(200, { "content-type": "text/css; charset=utf-8" });
      response.end(options.styles);
      return;
    }

    if (url === clientEntry) {
      void serveClientBundle(clientUrl, response);
      return;
    }

    if (url === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }

    listener(request, response);
  });

  const port = options.port ?? Number(process.env.PORT ?? 3000);
  server.listen(port, () => {
    console.log(`Fig Start: http://localhost:${port}/`);
  });
  return server;
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

async function serveClientBundle(
  url: URL,
  response: NodeResponseLike,
): Promise<void> {
  try {
    const code = await readFile(url);
    response.writeHead(200, {
      "content-type": "text/javascript; charset=utf-8",
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

async function renderServerRoutePayload(
  result: LoadResult,
  dataContext: unknown,
): Promise<SerializedRscPayload | undefined> {
  if (result.status !== "match") return undefined;
  const leaf = result.matches[result.matches.length - 1];
  if (leaf === undefined || leaf.node.route.options.server !== true) {
    return undefined;
  }

  const Component = leaf.node.route.options.component;
  if (Component === undefined) return undefined;

  // Server route components receive { params, loaderData } as props (they cannot
  // use router hooks — they render in an isolated RSC pass).
  const rsc = renderToRscStream(
    createElement(Component as ElementType, {
      loaderData: leaf.loaderData,
      params: leaf.params,
    }),
    { dataContext },
  );
  await rsc.allReady;
  const rows = await drainStream(rsc.stream);
  reportServerRouteErrors(leaf.routeId, rows);
  return { routeId: leaf.routeId, rows };
}

// A throw inside a server component becomes an RSC "error" row (it doesn't reject
// allReady), so the request would otherwise return 200 with no server log. Surface
// it; the client error boundary renders it on its side.
function reportServerRouteErrors(routeId: string, rows: string): void {
  if (!rows.includes('"tag":"error"')) return;
  for (const line of rows.split("\n")) {
    if (line.length === 0) continue;
    let row: { tag?: string; value?: { message?: string } };
    try {
      row = JSON.parse(line) as typeof row;
    } catch {
      continue;
    }
    if (row.tag === "error") {
      console.error(
        `[fig-start] server route "${routeId}" failed to render: ${
          row.value?.message ?? "unknown error"
        }`,
      );
    }
  }
}

async function drainStream(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      output += decoder.decode();
      return output;
    }
    output += decoder.decode(value, { stream: true });
  }
}

function renderBootstrap(input: {
  clientEntry: string;
  dataEntries: readonly FigDataHydrationEntry[];
  location: string;
  loaderData: Record<string, unknown>;
  nonce: string | undefined;
  rsc: SerializedRscPayload | undefined;
}): string {
  const state: SerializedRouterState = {
    href: input.location,
    loaderData: input.loaderData,
  };
  const nonceAttr =
    input.nonce === undefined ? "" : ` nonce="${escapeAttribute(input.nonce)}"`;

  const rscScript =
    input.rsc === undefined
      ? ""
      : `<script id="${RSC_PAYLOAD_SCRIPT_ID}" type="application/json"${nonceAttr}>${escapeJson(
          input.rsc,
        )}</script>`;

  return [
    `<script id="${ROUTER_STATE_SCRIPT_ID}" type="application/json"${nonceAttr}>${escapeJson(
      state,
    )}</script>`,
    `<script id="${DATA_SCRIPT_ID}" type="application/json"${nonceAttr}>${escapeJson(
      input.dataEntries,
    )}</script>`,
    rscScript,
    `<script type="module"${nonceAttr} src="${escapeAttribute(
      input.clientEntry,
    )}"></script>`,
  ].join("");
}

// Inject the bootstrap right before the document's </body> so the client entry
// and hydration data load with the shell.
function injectBeforeBodyClose(
  stream: ReadableStream<Uint8Array>,
  html: string,
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
          if (!injected) controller.enqueue(encoder.encode(html));
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

        controller.enqueue(
          encoder.encode(buffer.slice(0, index) + html + buffer.slice(index)),
        );
        injected = true;
        buffer = "";
      }
    },
  });
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
