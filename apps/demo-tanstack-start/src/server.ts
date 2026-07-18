import { readFile } from "node:fs/promises";
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { defaultStreamHandler } from "@bgub/fig-tanstack-start/server";
import { createRequestHandler } from "@tanstack/router-core/ssr/server";
import { createAppRouter } from "./router.tsx";

const port = Number(process.env.PORT ?? 4185);
const clientUrl = new URL("../dist/client.js", import.meta.url);
const styleUrl = new URL("../dist/style.css", import.meta.url);
const noStore = { "cache-control": "no-store" };

createServer((request, response) => {
  void handleRequest(request, response).catch((error: unknown) => {
    console.error(error);
    if (response.headersSent) {
      response.end();
      return;
    }
    response.writeHead(500, {
      "content-type": "text/plain; charset=utf-8",
    });
    response.end(error instanceof Error ? error.message : String(error));
  });
}).listen(port, "127.0.0.1", () => {
  console.log(`Fig TanStack Start demo: ${publicUrl(port)}`);
});

async function handleRequest(
  incoming: IncomingMessage,
  outgoing: ServerResponse,
): Promise<void> {
  const url = requestUrl(incoming, port);
  if (url.pathname === "/client.js") {
    await sendFile(outgoing, clientUrl, "text/javascript; charset=utf-8");
    return;
  }
  if (url.pathname === "/style.css") {
    await sendFile(outgoing, styleUrl, "text/css; charset=utf-8");
    return;
  }
  if (url.pathname === "/favicon.ico") {
    outgoing.writeHead(204);
    outgoing.end();
    return;
  }

  const controller = new AbortController();
  outgoing.once("close", () => {
    if (!outgoing.writableEnded) controller.abort("client disconnected");
  });
  const request = new Request(url, {
    headers: webHeaders(incoming.headers),
    method: incoming.method ?? "GET",
    signal: controller.signal,
  });
  const handleRouterRequest = createRequestHandler({
    createRouter: () => createAppRouter({ isServer: true }),
    request,
  });
  const response = await handleRouterRequest(defaultStreamHandler);
  await sendResponse(outgoing, response);
}

function requestUrl(request: IncomingMessage, fallbackPort: number): URL {
  const host = Array.isArray(request.headers.host)
    ? request.headers.host[0]
    : (request.headers.host ?? `127.0.0.1:${fallbackPort}`);
  const forwardedProtocol = request.headers["x-forwarded-proto"];
  const protocol = Array.isArray(forwardedProtocol)
    ? forwardedProtocol[0]
    : (forwardedProtocol ?? "http");
  return new URL(request.url ?? "/", `${protocol}://${host}`);
}

function webHeaders(headers: IncomingHttpHeaders): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) result.append(name, item);
    } else if (value !== undefined) {
      result.set(name, value);
    }
  }
  return result;
}

async function sendFile(
  response: ServerResponse,
  url: URL,
  contentType: string,
): Promise<void> {
  try {
    response.writeHead(200, { ...noStore, "content-type": contentType });
    response.end(await readFile(url));
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

async function sendResponse(
  outgoing: ServerResponse,
  response: Response,
): Promise<void> {
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body === null) {
    outgoing.end();
    return;
  }

  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!outgoing.write(value)) await waitForDrain(outgoing);
    }
  } finally {
    reader.releaseLock();
  }
  if (!outgoing.writableEnded) outgoing.end();
}

function waitForDrain(response: ServerResponse): Promise<void> {
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

function publicUrl(serverPort: number): string {
  return process.env.PORTLESS_URL ?? `http://127.0.0.1:${serverPort}/`;
}
