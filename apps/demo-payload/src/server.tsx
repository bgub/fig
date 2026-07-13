import { readFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { FigDevtools } from "@bgub/fig-devtools";
import {
  createRenderTreeCollector,
  renderToDocumentStream,
} from "@bgub/fig-server";
import {
  createPayloadConsumer,
  PAYLOAD_BOUNDARY_HEADER,
  payloadFrameBootstrapCode,
  payloadFrameScript,
  renderToPayloadStream,
} from "@bgub/fig-server/payload";
import { AppRefreshButton, RefreshButton } from "./client-components.tsx";
import { ResourcePost, resourceComments } from "./resource-app.tsx";
import { brokenResourceSeed, resourceRootId } from "./resource-shared.ts";
import {
  createDemoData,
  Dashboard,
  type DemoData,
  OperationsNote,
  PayloadApp,
} from "./app.tsx";
import {
  devReloadScript,
  handleDevReloadRequest,
  watchDevReloadFile,
} from "../../dev-reload.ts";
import {
  DevtoolsSnapshotScript,
  prerenderedDevtools,
} from "@bgub/fig-devtools/server";
import { devtoolsOpenFromCookieHeader } from "../../demo-devtools-cookie.ts";
import {
  appRefreshButtonReferenceId,
  appRootId,
  devtoolsPaneId,
  feedBoundaryId,
  noteBoundaryId,
  refreshButtonReferenceId,
} from "./shared.ts";
import { styles } from "./styles.ts";

const port = Number(process.env.PORT ?? 5174);
const clientScriptUrl = new URL("../dist/client.js", import.meta.url);
const noStore = { "cache-control": "no-store" } as const;
const textCss = { ...noStore, "content-type": "text/css; charset=utf-8" };
const textJs = {
  ...noStore,
  "content-type": "text/javascript; charset=utf-8",
};
const textPlain = { "content-type": "text/plain; charset=utf-8" };
const textHtml = {
  ...noStore,
  "content-type": "text/html; charset=utf-8",
};
const textEncoder = new TextEncoder();
const devReloadScriptBytes = textEncoder.encode(devReloadScript());

watchDevReloadFile(clientScriptUrl);

createServer((request, response) => {
  void handleRequest(request, response).catch((error: unknown) => {
    if (response.headersSent) {
      response.end();
      return;
    }

    response.writeHead(500, textPlain);
    response.end(error instanceof Error ? error.message : String(error));
  });
}).listen(port, "127.0.0.1", () => {
  console.log(`Fig payload demo: ${publicUrl(port)}`);
});

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = requestUrl(request);
  if (handleDevReloadRequest(request, response, url)) return;

  switch (url.pathname) {
    case "/":
      await sendDocument(request, response, url);
      return;
    case "/client.js":
      await sendFile(response, clientScriptUrl, textJs);
      return;
    case "/favicon.ico":
      response.writeHead(204);
      response.end();
      return;
    case "/payload":
      await sendPayload(request, response, url);
      return;
    case "/resource":
      send(response, 200, resourceDocument(), textHtml);
      return;
    case "/resource-payload":
      await sendResourcePayload(response, url);
      return;
    case "/style.css":
      send(response, 200, styles, textCss);
      return;
    default:
      send(response, 404, "Not found", textPlain);
  }
}

async function sendPayload(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const seed = seedFor(url);
  const boundary = headerValue(request.headers[PAYLOAD_BOUNDARY_HEADER]);
  const data = createDemoData(seed);
  const boundaryRefresh = boundaryReplacement(boundary, data);
  const refreshBoundary =
    boundaryRefresh === null || boundary === null ? undefined : boundary;
  const result = renderToPayloadStream(
    boundaryRefresh ?? <PayloadApp data={data} />,
    {
      refreshBoundary,
    },
  );

  response.writeHead(200, {
    ...noStore,
    "content-type": result.contentType,
    "x-accel-buffering": "no",
  });
  await pipeStream(result.stream, response);
}

// The resource-model endpoint (docs/plans/serialized-components.md): a plain
// payload stream per post, no boundary options — the client refreshes it as
// an ordinary data resource. Seed 500 fails so the demo covers pre-root
// failure and recovery.
async function sendResourcePayload(
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const seed = seedFor(url);
  if (seed === brokenResourceSeed) {
    send(response, 500, "Resource payload unavailable", textPlain);
    return;
  }

  const result = renderToPayloadStream(
    <ResourcePost comments={resourceComments(seed)} seed={seed} />,
    {
      onError() {
        return { digest: "resource-payload" };
      },
    },
  );

  response.writeHead(200, {
    ...noStore,
    "content-type": result.contentType,
    "x-accel-buffering": "no",
  });
  await pipeStream(result.stream, response);
}

// The /resource page is deliberately client-mounted (no SSR/hydration): the
// non-authoritative demo path proves the resource model on its own before
// fig-start's document integration.
function resourceDocument(): string {
  return (
    '<!doctype html><html lang="en"><head>' +
    '<meta charset="utf-8" />' +
    '<meta name="viewport" content="width=device-width, initial-scale=1" />' +
    "<title>Fig serialized components</title>" +
    '<link rel="stylesheet" href="/style.css" />' +
    "</head><body>" +
    `<div id="${resourceRootId}"></div>` +
    devReloadScript() +
    '<script src="/client.js" type="module"></script>' +
    "</body></html>"
  );
}

function boundaryReplacement(boundary: string | null, data: DemoData) {
  switch (boundary) {
    case feedBoundaryId:
      return <Dashboard data={data} />;
    case noteBoundaryId:
      return <OperationsNote data={data} />;
    default:
      return null;
  }
}

// The initial document is server-rendered FROM the payload: one
// renderToPayloadStream call is teed — one branch decodes into a server-side
// payload consumer whose root renders (and streams Suspense reveals) through
// renderToDocumentStream, the other is forwarded to the browser as inline
// frame scripts for hydration. HTML and payload come from the same render,
// so the hydrated client tree matches the streamed markup byte for byte.
// The same document render fills the render-tree collector the DevTools
// panel prerenders from.
async function sendDocument(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const seed = seedFor(url);
  const data = createDemoData(seed);
  const payload = renderToPayloadStream(<PayloadApp data={data} />, {});
  void payload.allReady.catch(() => undefined);
  const [ssrRows, clientRows] = payload.stream.tee();

  const ssrPayload = createPayloadConsumer({
    resolveClientReference(metadata) {
      if (metadata.id === appRefreshButtonReferenceId) return AppRefreshButton;
      if (metadata.id === refreshButtonReferenceId) return RefreshButton;
      throw new Error(`Unknown client reference "${metadata.id}".`);
    },
  });
  void ssrPayload.processStream(ssrRows).catch(() => undefined);
  await ssrPayload.rootReady;

  const renderTree = createRenderTreeCollector();
  const devtools = prerenderedDevtools(renderTree, appRootId);
  const devtoolsOpen = devtoolsOpenFromCookieHeader(request.headers.cookie);
  const render = renderToDocumentStream(
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Fig payload Demo</title>
        <link rel="stylesheet" href="/style.css" />
        <script unsafeHTML={payloadFrameBootstrapCode()} />
      </head>
      <body>
        <div class="fig-demo-devtools-layout">
          <div class="fig-demo-app-pane">
            <div id={appRootId}>{ssrPayload.getRoot()}</div>
          </div>
          <aside class="fig-demo-devtools-pane" id={devtoolsPaneId}>
            {/* The aside renders after the app pane, so the collector holds
                the app's tree when the panel reads the hook; the client
                hydrates it against the same snapshot (inlined below) and
                swaps to the live hook after the first commit. */}
            <FigDevtools
              defaultOpen={devtoolsOpen}
              hook={devtools.hook}
              placement="sidebar"
            />
          </aside>
        </div>
        <DevtoolsSnapshotScript devtools={devtools} />
        <script src="/client.js" type="module" />
      </body>
    </html>,
    {
      onError() {
        return { digest: "payload-demo-boundary" };
      },
      renderTree,
    },
  );

  await render.shellReady;
  response.writeHead(200, {
    ...noStore,
    "content-type": render.contentType,
    "x-accel-buffering": "no",
  });
  await interleaveDocument(render.stream, clientRows, response);
}

// Writes HTML chunks as they stream and flushes buffered payload rows as
// inline frame scripts between them (fig-server emits complete markup per
// chunk, so between-chunk injection is parse-safe — the contract in
// docs/concepts/server-rendering.md that the demo-ssr bootstrap injection also
// relies on).
async function interleaveDocument(
  html: ReadableStream<Uint8Array>,
  rows: ReadableStream<Uint8Array>,
  response: ServerResponse,
): Promise<void> {
  let pendingFrames: string[] = [];
  const decoder = new TextDecoder();
  const rowsReader = rows.getReader();
  const rowsDone = (async () => {
    for (;;) {
      const { done, value } = await rowsReader.read();
      // A default reader's final read carries no value; decoding undefined
      // without stream mode is exactly the flush.
      const text = decoder.decode(value, { stream: !done });
      if (text.length > 0) pendingFrames.push(text);
      if (done) return;
    }
  })();

  const flushFrames = async (): Promise<void> => {
    if (pendingFrames.length === 0) return;
    const scripts = pendingFrames
      .map((frame) => payloadFrameScript(frame))
      .join("");
    pendingFrames = [];
    await writeResponse(response, textEncoder.encode(scripts));
  };

  const htmlReader = html.getReader();
  try {
    // The shell is complete (shellReady was awaited), so the first chunk is
    // a safe spot for the dev-reload script.
    const shell = await htmlReader.read();
    if (shell.value !== undefined) await writeResponse(response, shell.value);
    await writeResponse(response, devReloadScriptBytes);
    await flushFrames();

    while (!shell.done) {
      const { done, value } = await htmlReader.read();
      if (value !== undefined) await writeResponse(response, value);
      await flushFrames();
      if (done) break;
    }
    // The last payload rows land with (or just after) the last HTML reveal.
    await rowsDone;
    await flushFrames();
  } finally {
    response.end();
  }
}

function requestUrl(request: IncomingMessage): URL {
  const host = Array.isArray(request.headers.host)
    ? request.headers.host[0]
    : (request.headers.host ?? `127.0.0.1:${port}`);

  return new URL(request.url ?? "/", `http://${host}`);
}

function publicUrl(port: number): string {
  return process.env.PORTLESS_URL ?? `http://127.0.0.1:${port}/`;
}

function seedFor(url: URL): number {
  const explicit = Number(url.searchParams.get("seed"));
  if (Number.isInteger(explicit)) return explicit;
  return Math.floor(Date.now() / 1000) % 1000;
}

async function pipeStream(
  stream: ReadableStream<Uint8Array>,
  response: ServerResponse,
): Promise<void> {
  const reader = stream.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      await writeResponse(response, value);
    }
  } finally {
    response.end();
  }
}

async function sendFile(
  response: ServerResponse,
  url: URL,
  headers: Record<string, string>,
): Promise<void> {
  send(response, 200, await readFile(url), headers);
}

function send(
  response: ServerResponse,
  status: number,
  body: string | Uint8Array,
  headers: Record<string, string>,
): void {
  response.writeHead(status, headers);
  response.end(body);
}

function writeResponse(
  response: ServerResponse,
  chunk: Uint8Array,
): Promise<void> {
  if (response.destroyed || response.writableEnded) return Promise.resolve();
  if (response.write(chunk)) return Promise.resolve();

  return new Promise((resolve) => {
    const finish = () => {
      response.off("close", finish);
      response.off("drain", finish);
      resolve();
    };

    response.on("close", finish);
    response.on("drain", finish);
  });
}

function headerValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
