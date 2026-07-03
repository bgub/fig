import { readFile } from "node:fs/promises";
import {
  type ClientAssetResolver,
  isServableAssetPath,
  requestPathname,
} from "../server-assets.ts";
import type { StartHandler } from "../server.ts";
import { contentTypeFor } from "./content-type.ts";

// Wraps the route handler with built-client-asset serving, staying entirely
// in web-standard Request/Response terms so any server adapter can host it.
export function createStartWebHandler(input: {
  cacheClientAssets: boolean;
  clientAssets: ClientAssetResolver;
  handler: StartHandler;
}): StartHandler {
  return async (request) => {
    const pathname = new URL(request.url).pathname;
    if (!isAssetRequest(request.method, pathname)) {
      return input.handler(request);
    }

    const assetUrl = await input.clientAssets
      .resolve(pathname)
      .catch(() => null);
    if (assetUrl === null) return input.handler(request);

    return serveClientAsset(
      assetUrl,
      request.method === "HEAD",
      input.cacheClientAssets,
    );
  };
}

function isAssetRequest(method: string, pathname: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  const path = requestPathname(pathname);
  const name = path.slice(path.lastIndexOf("/") + 1);
  return isServableAssetPath(name);
}

async function serveClientAsset(
  url: URL,
  headOnly: boolean,
  cache: boolean,
): Promise<Response> {
  let code: Uint8Array<ArrayBuffer>;
  try {
    // Copy out of Node's shared Buffer pool so the body is a plain
    // ArrayBuffer-backed Uint8Array, as BodyInit requires.
    code = new Uint8Array(await readFile(url));
  } catch {
    return new Response(headOnly ? null : "client bundle not built", {
      status: 404,
    });
  }

  return new Response(headOnly ? null : code, {
    headers: {
      "cache-control": cache
        ? "public, max-age=31536000, immutable"
        : "no-store",
      "content-type": contentTypeFor(url.pathname),
    },
    status: 200,
  });
}
