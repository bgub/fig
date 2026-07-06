import { readFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { renderToHtml } from "@bgub/fig-server";
import {
  type PayloadRenderResult,
  renderToPayloadStream,
} from "@bgub/fig-server/payload";
import { createDemoData, Dashboard, PayloadApp } from "./app.tsx";
import {
  devReloadScript,
  handleDevReloadRequest,
  watchDevReloadFile,
} from "../../dev-reload.ts";
import { appRootId, feedBoundaryId } from "./shared.ts";
import { LoadingShell } from "./shell.tsx";
import { styles } from "./styles.ts";

const port = Number(process.env.PORT ?? 5174);
const clientScriptUrl = new URL("../dist/client.js", import.meta.url);
const noStore = { "cache-control": "no-store" } as const;
const textHtml = { ...noStore, "content-type": "text/html; charset=utf-8" };
const textCss = { ...noStore, "content-type": "text/css; charset=utf-8" };
const textJs = {
  ...noStore,
  "content-type": "text/javascript; charset=utf-8",
};
const textPlain = { "content-type": "text/plain; charset=utf-8" };

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
      send(response, 200, await documentHtml(), textHtml);
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
  const boundary = headerValue(request.headers["x-fig-payload-boundary"]);
  const data = createDemoData(seed);
  const refreshingFeed = boundary === feedBoundaryId;
  const result = renderToPayloadStream(
    refreshingFeed ? <Dashboard data={data} /> : <PayloadApp data={data} />,
    {
      refreshBoundary: refreshingFeed ? boundary : undefined,
    },
  );

  response.writeHead(200, {
    ...noStore,
    "content-type": result.contentType,
    "x-accel-buffering": "no",
  });
  await pipePayload(result, response);
}

async function documentHtml(): Promise<string> {
  const shell = await renderToHtml(<LoadingShell />);

  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>Fig payload Demo</title>",
    '<link rel="stylesheet" href="/style.css">',
    "</head>",
    "<body>",
    `<div id="${appRootId}">${shell}</div>`,
    devReloadScript(),
    '<script type="module" src="/client.js"></script>',
    "</body>",
    "</html>",
  ].join("");
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

async function pipePayload(
  result: PayloadRenderResult,
  response: ServerResponse,
): Promise<void> {
  const reader = result.stream.getReader();

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
