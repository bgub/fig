import { readFile } from "node:fs/promises";
import type { RequestListener } from "node:http";
import {
  type ClientAssetResolver,
  isServableAssetPath,
  requestPathname,
} from "../server-assets.ts";
import type { StartHandler } from "../server.ts";
import { contentTypeFor } from "./content-type.ts";

export type StartNodeRequestListener = RequestListener;

export function createStartNodeRequestListener(input: {
  cacheClientAssets: boolean;
  clientAssets: ClientAssetResolver;
  handler: StartHandler;
}): StartNodeRequestListener {
  const listener = createNodeRequestListener(input.handler);

  return (request, response) => {
    const url = request.url ?? "/";

    void serveClientAssetOrRoute({
      cacheClientAssets: input.cacheClientAssets,
      clientAssets: input.clientAssets,
      listener,
      request,
      response,
      url,
    });
  };
}

interface ServeClientAssetOrRouteInput {
  cacheClientAssets: boolean;
  clientAssets: ClientAssetResolver;
  listener: RequestListener;
  request: Parameters<RequestListener>[0];
  response: Parameters<RequestListener>[1];
  url: string;
}

async function serveClientAssetOrRoute(
  input: ServeClientAssetOrRouteInput,
): Promise<void> {
  if (!isAssetRequest(input.request.method, input.url)) {
    input.listener(input.request, input.response);
    return;
  }

  let assetUrl: URL | null;
  try {
    assetUrl = await input.clientAssets.resolve(input.url);
  } catch {
    input.listener(input.request, input.response);
    return;
  }

  if (assetUrl !== null) {
    await serveClientAsset(
      assetUrl,
      input.request.method === "HEAD",
      input.response,
      input.cacheClientAssets,
    );
    return;
  }

  input.listener(input.request, input.response);
}

function isAssetRequest(method: string | undefined, url: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  const pathname = requestPathname(url);
  const name = pathname.slice(pathname.lastIndexOf("/") + 1);
  return isServableAssetPath(name);
}

function createNodeRequestListener(handler: StartHandler): RequestListener {
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
  headOnly: boolean,
  response: Parameters<RequestListener>[1],
  cache: boolean,
): Promise<void> {
  try {
    const code = await readFile(url);
    response.writeHead(200, {
      "cache-control": cache
        ? "public, max-age=31536000, immutable"
        : "no-store",
      "content-type": contentTypeFor(url.pathname),
    });
    if (headOnly) response.end();
    else response.end(code);
  } catch {
    response.writeHead(404);
    if (headOnly) response.end();
    else response.end("client bundle not built");
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
