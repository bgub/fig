import { readFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { renderToPayloadStream } from "@bgub/fig-server/payload";
import {
  devReloadScript,
  handleDevReloadRequest,
  watchDevReloadFile,
} from "../../dev-reload.ts";
import { ResourcePost, resourceComments } from "./resource-app.tsx";
import { brokenResourceSeed, resourceRootId } from "./resource-shared.ts";
import { styles } from "./styles.ts";

// The standalone serialized-components demo (docs/plans/serialized-components.md):
// no framework, no boundaries, no refresh protocol — one route serving a payload
// stream, one client consuming it as an ordinary data resource.

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
  console.log(`Fig payload demo: ${publicUrl()}`);
});

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = requestUrl(request);
  if (handleDevReloadRequest(request, response, url)) return;

  switch (url.pathname) {
    case "/":
      send(response, 200, resourceDocument, textHtml);
      return;
    case "/client.js":
      await sendFile(response, clientScriptUrl, textJs);
      return;
    case "/favicon.ico":
      response.writeHead(204);
      response.end();
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

// The serialized-components endpoint: a plain payload stream per post. The
// client refreshes it with refreshData and navigates by resource key. Seed
// 500 fails so the demo covers pre-root failure and recovery. The response
// is deliberately delayed so the template's slots visibly fill in sequence:
// app shell instantly, payload shell after the delay, streamed holes after
// their own reads settle.
const RESOURCE_PAYLOAD_DELAY_MS = 500;

async function sendResourcePayload(
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const seed = seedFor(url);
  await new Promise((resolve) =>
    setTimeout(resolve, RESOURCE_PAYLOAD_DELAY_MS),
  );
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

const resourceDocument =
  '<!doctype html><html lang="en"><head>' +
  '<meta charset="utf-8" />' +
  '<meta name="viewport" content="width=device-width, initial-scale=1" />' +
  "<title>Fig serialized components</title>" +
  '<link rel="stylesheet" href="/style.css" />' +
  "</head><body>" +
  `<div id="${resourceRootId}"></div>` +
  devReloadScript() +
  '<script src="/client.js" type="module"></script>' +
  "</body></html>";

function requestUrl(request: IncomingMessage): URL {
  const host = Array.isArray(request.headers.host)
    ? request.headers.host[0]
    : (request.headers.host ?? `127.0.0.1:${port}`);

  return new URL(request.url ?? "/", `http://${host}`);
}

function publicUrl(): string {
  return process.env.PORTLESS_URL ?? `http://127.0.0.1:${port}/`;
}

function seedFor(url: URL): number {
  const explicit = Number(url.searchParams.get("seed"));
  if (Number.isInteger(explicit)) return explicit;
  return 1;
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
