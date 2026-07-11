import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { assets, meta, title } from "@bgub/fig";
import { FigDevtools } from "@bgub/fig-devtools";
import {
  createRenderTreeCollector,
  escapeAttribute,
  escapeText,
  renderToDocumentStream,
} from "@bgub/fig-server";
import type { FigDataHydrationEntry } from "@bgub/fig";
import type { DataResourceKey, DataResourceLoadContext } from "@bgub/fig";
import { normalizeDataResourceKey } from "@bgub/fig/internal";
import {
  App,
  clientDataFor,
  createServerRequest,
  type DemoRequest,
  demoDataResourceScriptId,
  demoDataScriptId,
  demoDevtoolsPaneId,
  demoRootId,
  scaledDemoDelay,
  serverInfoResourceId,
  streamBoundaryDigest,
  streamIdentifierPrefix,
} from "./app.tsx";
import {
  DevtoolsSnapshotScript,
  devtoolsOpenFromCookieHeader,
  prerenderedDevtools,
} from "../../demo-devtools-prerender.ts";
import {
  createServerInfo,
  createServerInfoResource,
  createServerOnlyInfoResource,
  serverInfoResource,
} from "./data.server.ts";
import {
  devReloadScript,
  handleDevReloadRequest,
  watchDevReloadFile,
} from "../../dev-reload.ts";
import { styles } from "./styles.ts";

const port = Number(process.env.PORT ?? 4180);
const logRecoveredErrors = process.env.FIG_STREAM_DEMO_LOG_ERRORS === "1";
const clientScriptUrl = new URL("../dist/client.js", import.meta.url);
const dataEndpointPath = "/__fig/data";
const noStore = { "cache-control": "no-store" };
const textPlain = { "content-type": "text/plain; charset=utf-8" };

interface DataResourceRequestBody {
  args: readonly unknown[];
  id: string;
}

interface CallableServerDataResource {
  key: (...args: unknown[]) => DataResourceKey;
  load: (...argsAndContext: [...unknown[], DataResourceLoadContext]) => unknown;
}

const dataResourceRegistry: Record<string, unknown> = {
  [serverInfoResourceId]: serverInfoResource,
};

watchDevReloadFile(clientScriptUrl);

createServer((request, response) => {
  void handleRequest(request, response).catch((error: unknown) => {
    if (response.headersSent) {
      response.end(`<!-- ${escapeComment(error)} -->`);
      return;
    }

    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end(error instanceof Error ? error.message : String(error));
  });
}).listen(port, "127.0.0.1", () => {
  console.log(`Fig streaming SSR demo: ${publicUrl(port)}`);
});

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const host = Array.isArray(request.headers.host)
    ? request.headers.host[0]
    : (request.headers.host ?? `127.0.0.1:${port}`);
  const url = new URL(request.url ?? "/", `http://${host}`);
  if (handleDevReloadRequest(request, response, url)) return;

  if (url.pathname === dataEndpointPath) {
    await handleDataResourceRequest(request, response);
    return;
  }

  if (url.pathname === "/style.css") {
    send(response, 200, styles, {
      ...noStore,
      "content-type": "text/css; charset=utf-8",
    });
    return;
  }

  if (url.pathname === "/client.js") {
    await sendFile(response, clientScriptUrl, {
      ...noStore,
      "content-type": "text/javascript; charset=utf-8",
    });
    return;
  }

  if (url.pathname === "/favicon.ico") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (url.pathname !== "/" && url.pathname !== "/abort") {
    send(response, 404, "Not found", textPlain);
    return;
  }

  const abortDelay = abortDelayFor(url);
  const nonce = randomUUID();
  const demoRequest = createServerRequest(
    abortDelay,
    new Date().toLocaleTimeString(),
  );
  const requestId = nonce.slice(0, 8);
  const serverInfo = createServerInfo();
  const renderTree = createRenderTreeCollector();
  const devtools = prerenderedDevtools(renderTree, demoRootId);
  const render = renderToDocumentStream(
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="stylesheet" href="/style.css" />
      </head>
      <body>
        {/* The DevTools layout ships in the shell so the sidebar space is
            reserved from first paint; the client mounts the panel into the
            aside without reflowing the app. */}
        <div class="fig-demo-devtools-layout">
          <div class="fig-demo-app-pane">
            {assets(
              [
                title("Fig Streaming SSR"),
                meta({
                  name: "description",
                  content: "Fig streaming Suspense and hydration demo.",
                }),
              ],
              <div id={demoRootId}>
                <App
                  request={demoRequest}
                  serverInfoResource={createServerInfoResource(serverInfo)}
                  serverOnlyInfoResource={createServerOnlyInfoResource(
                    requestId,
                    serverInfo,
                  )}
                />
              </div>,
            )}
          </div>
          <aside class="fig-demo-devtools-pane" id={demoDevtoolsPaneId}>
            {/* The aside renders after the app pane, so the collector holds
                the app's tree by the time the panel reads the hook: the
                panel streams prerendered with the actual content. The client
                hydrates it against the same snapshot (inlined below) and
                swaps to the live hook after the first commit. */}
            <FigDevtools
              defaultOpen={devtoolsOpenFromCookieHeader(request.headers.cookie)}
              hook={devtools.hook}
              placement="sidebar"
            />
          </aside>
        </div>
        <DevtoolsSnapshotScript devtools={devtools} />
      </body>
    </html>,
    {
      identifierPrefix: streamIdentifierPrefix,
      nonce,
      renderTree,
      onError(error, info) {
        if (logRecoveredErrors) {
          console.error("Boundary recovered on the server", {
            error,
            stack: info.componentStack,
          });
        }
        return { digest: streamBoundaryDigest };
      },
    },
  );

  let closed = false;
  response.on("close", () => {
    closed = true;
    render.abort("client disconnected");
  });

  try {
    await render.shellReady;
  } catch (error) {
    console.error("Shell failed", error);
    send(response, 500, shellErrorHtml(error), {
      "content-type": "text/html; charset=utf-8",
    });
    return;
  }

  // The shell read fulfilled the server-info entry, so it is available to
  // serialize for client hydration alongside the streamed shell.
  const dataEntries = render.getData();

  response.writeHead(200, {
    ...noStore,
    "content-type": render.contentType,
    "x-accel-buffering": "no",
  });

  const abortTimer =
    abortDelay === null
      ? null
      : setTimeout(
          () => render.abort(`aborted after ${abortDelay}ms`),
          abortDelay,
        );

  try {
    await pipeStream(
      render.stream,
      response,
      bootstrapScripts(demoRequest, dataEntries, nonce),
    );
  } finally {
    if (abortTimer !== null) clearTimeout(abortTimer);
    if (!closed && !response.writableEnded) response.end();
  }
}

async function handleDataResourceRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  const body = await readDataResourceRequestBody(request);
  if (body === null) {
    sendJson(response, 400, { error: "Invalid request." });
    return;
  }

  const resource = dataResourceForId(body.id);
  if (resource === null) {
    sendJson(response, 404, { error: "Unknown data resource." });
    return;
  }

  const args = [...body.args];
  let key: DataResourceKey;
  try {
    key = resource.key(...args);
    normalizeDataResourceKey(key);
  } catch {
    sendJson(response, 400, { error: "Invalid data resource key." });
    return;
  }

  const controller = new AbortController();
  request.once("aborted", () => controller.abort());

  try {
    const value = await resource.load(...args, {
      signal: controller.signal,
    });
    sendJson(response, 200, { key, value });
  } catch {
    sendJson(response, 500, { error: "Data resource failed." });
  }
}

function dataResourceForId(id: string): CallableServerDataResource | null {
  return callableServerDataResource(dataResourceRegistry[id]);
}

function callableServerDataResource(
  value: unknown,
): CallableServerDataResource | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Partial<CallableServerDataResource>;
  return typeof record.key === "function" && typeof record.load === "function"
    ? (record as CallableServerDataResource)
    : null;
}

async function readDataResourceRequestBody(
  request: IncomingMessage,
): Promise<DataResourceRequestBody | null> {
  let body: unknown;
  try {
    body = JSON.parse(await readRequestText(request));
  } catch {
    return null;
  }

  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  return typeof record.id === "string" && Array.isArray(record.args)
    ? { args: record.args, id: record.id }
    : null;
}

async function readRequestText(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function abortDelayFor(url: URL): number | null {
  if (url.pathname === "/abort") return scaledDemoDelay(900);

  const value = url.searchParams.get("abort");
  if (value === null) return null;

  const delayMs = Number(value);
  return Number.isFinite(delayMs) && delayMs > 0 ? delayMs : null;
}

function publicUrl(port: number): string {
  return process.env.PORTLESS_URL ?? `http://127.0.0.1:${port}/`;
}

function bootstrapScripts(
  request: DemoRequest,
  dataEntries: readonly FigDataHydrationEntry[],
  nonce: string,
): string {
  return [
    `<script id="${demoDataScriptId}" type="application/json" nonce="${escapeAttribute(
      nonce,
    )}">${escapeJson(clientDataFor(request))}</script>`,
    `<script id="${demoDataResourceScriptId}" type="application/json" nonce="${escapeAttribute(
      nonce,
    )}">${escapeJson(dataEntries)}</script>`,
    devReloadScript(nonce),
    `<script type="module" async nonce="${escapeAttribute(nonce)}" src="/client.js"></script>`,
  ].join("");
}

// The renderer flushes the whole shell as its first enqueue and keeps later
// chunk boundaries at complete-markup edges (concepts/server-rendering.md),
// so appending the bootstrap to the first chunk lands it right after the
// shell — DevTools aside included — inside one write. No write boundary ever
// splits the shell, so the browser gets no paint opportunity between the app
// pane and the aside that reserves the sidebar.
async function pipeStream(
  stream: ReadableStream<Uint8Array>,
  response: ServerResponse,
  bootstrap: string,
): Promise<void> {
  const reader = stream.getReader();
  let bootstrapped = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      if (!bootstrapped) await writeResponse(response, bootstrap);
      return;
    }
    if (bootstrapped) {
      await writeResponse(response, value);
      continue;
    }

    bootstrapped = true;
    await writeResponse(
      response,
      Buffer.concat([value, Buffer.from(bootstrap)]),
    );
  }
}

function writeResponse(
  response: ServerResponse,
  chunk: string | Uint8Array,
): Promise<void> {
  if (response.destroyed || response.writableEnded) return Promise.resolve();
  if (response.write(chunk)) return Promise.resolve();

  return new Promise((resolve) => {
    const finish = () => {
      response.off("close", finish);
      response.off("drain", finish);
      response.off("error", finish);
      resolve();
    };

    response.once("close", finish);
    response.once("drain", finish);
    response.once("error", finish);
  });
}

function send(
  response: ServerResponse,
  status: number,
  body: string,
  headers: Record<string, string>,
): void {
  response.writeHead(status, headers);
  response.end(body);
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  send(response, status, JSON.stringify(body), {
    ...noStore,
    "content-type": "application/json; charset=utf-8",
  });
}

async function sendFile(
  response: ServerResponse,
  url: URL,
  headers: Record<string, string>,
): Promise<void> {
  try {
    send(response, 200, await readFile(url, "utf8"), headers);
  } catch {
    send(response, 404, "Not found", textPlain);
  }
}

function shellErrorHtml(error: unknown): string {
  return `<!doctype html><html lang="en"><body><pre>${escapeText(
    error instanceof Error ? error.message : String(error),
  )}</pre></body></html>`;
}

function escapeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003C");
}

function escapeComment(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(
    /-->/g,
    "--\\>",
  );
}
