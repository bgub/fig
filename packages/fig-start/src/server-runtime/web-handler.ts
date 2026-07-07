import type { StartHandler } from "../server.ts";
import type { ClientAssetResolver } from "../server-assets.ts";
import { isClientAssetRequest, serveClientAsset } from "./static-assets.ts";

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

    return serveClientAsset({
      cache: input.cacheClientAssets,
      headOnly: request.method === "HEAD",
      url: assetUrl,
    });
  };
}

function isAssetRequest(method: string, pathname: string): boolean {
  return isClientAssetRequest(method, pathname);
}
