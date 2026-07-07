import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { Effect } from "effect";
import type { StartHandler } from "../server.ts";
import { StartListenError } from "./errors.ts";

export function createStartNodeServer(): Server {
  return createServer();
}

export function serveStartNodeHttp(input: {
  handler: StartHandler;
  port: number;
  server: Server;
}) {
  return Effect.acquireRelease(
    Effect.callback<NodeHttpLease, StartListenError>((resume) => {
      const onRequest = (
        request: IncomingMessage,
        response: ServerResponse,
      ): void => {
        if (isUpgradeRequest(request)) return;
        void handleNodeRequest(input.handler, request, response);
      };
      const onError = (cause: Error): void => {
        input.server.off("request", onRequest);
        resume(Effect.fail(new StartListenError({ cause, port: input.port })));
      };
      const onListening = (): void => {
        input.server.off("error", onError);
        resume(Effect.succeed({ onRequest, server: input.server }));
      };

      input.server.on("request", onRequest);
      input.server.once("error", onError);
      input.server.listen(input.port, onListening);

      return Effect.sync(() => {
        input.server.off("error", onError);
        input.server.off("request", onRequest);
      });
    }),
    ({ onRequest, server }) =>
      Effect.callback<void>((resume) => {
        server.off("request", onRequest);
        if (!server.listening) {
          resume(Effect.void);
          return;
        }
        server.close(() => resume(Effect.void));
      }),
  );
}

export function awaitServerClose(server: Server): Effect.Effect<void> {
  return Effect.callback<void>((resume) => {
    const onClose = (): void => resume(Effect.void);
    server.once("close", onClose);
    return Effect.sync(() => {
      server.off("close", onClose);
    });
  });
}

function requestCanHaveBody(method: string): boolean {
  return method !== "GET" && method !== "HEAD";
}

interface NodeHttpLease {
  onRequest: (request: IncomingMessage, response: ServerResponse) => void;
  server: Server;
}

function isUpgradeRequest(request: IncomingMessage): boolean {
  return request.headers.upgrade !== undefined;
}

async function handleNodeRequest(
  handler: StartHandler,
  nodeRequest: IncomingMessage,
  nodeResponse: ServerResponse,
): Promise<void> {
  try {
    const request = await nodeRequestToWebRequest(nodeRequest);
    const response = await handler(request);
    await writeWebResponse(response, nodeRequest.method, nodeResponse);
  } catch (error) {
    writeInternalServerError(nodeResponse, error);
  }
}

async function nodeRequestToWebRequest(
  request: IncomingMessage,
): Promise<Request> {
  const host = request.headers.host ?? "localhost";
  const method = request.method ?? "GET";
  const body = requestCanHaveBody(method)
    ? await readNodeRequestBody(request)
    : undefined;

  return new Request(`http://${host}${request.url ?? "/"}`, {
    body,
    headers: nodeHeaders(request),
    method,
  });
}

function nodeHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }
  return headers;
}

async function readNodeRequestBody(
  request: IncomingMessage,
): Promise<ArrayBuffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks);
  const arrayBuffer = new ArrayBuffer(body.byteLength);
  new Uint8Array(arrayBuffer).set(body);
  return arrayBuffer;
}

async function writeWebResponse(
  response: Response,
  requestMethod: string | undefined,
  nodeResponse: ServerResponse,
): Promise<void> {
  nodeResponse.statusCode = response.status;
  nodeResponse.statusMessage = response.statusText;
  response.headers.forEach((value, name) => {
    nodeResponse.setHeader(name, value);
  });

  if (requestMethod === "HEAD" || response.body === null) {
    nodeResponse.end();
    return;
  }

  const reader = response.body.getReader();
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    await writeNodeResponseChunk(nodeResponse, result.value);
  }
  nodeResponse.end();
}

function writeNodeResponseChunk(
  response: ServerResponse,
  chunk: Uint8Array,
): Promise<void> {
  if (response.write(chunk)) return Promise.resolve();
  return new Promise((resolve) => {
    response.once("drain", resolve);
  });
}

function writeInternalServerError(
  response: ServerResponse,
  error: unknown,
): void {
  if (response.headersSent) {
    response.destroy(error instanceof Error ? error : undefined);
    return;
  }
  response.statusCode = 500;
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.end(
    error instanceof Error ? error.message : "Internal Server Error",
  );
}
