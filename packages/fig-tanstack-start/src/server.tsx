import type { FigNode } from "@bgub/fig";
import type { ServerPreloadHeaderOptions } from "@bgub/fig-server";
import {
  renderToPayloadStream,
  type PayloadRenderOptions,
} from "@bgub/fig-server/payload";
import {
  createStartHandler,
  type CreateStartHandlerOptions,
} from "@tanstack/start-server-core";
import type { AnyRouter } from "@tanstack/router-core";
import { compiledPayloadAssets } from "./payload-assets.ts";
import { renderRouterDocument } from "./server-renderer.tsx";
import { getStartContext } from "./start-context.ts";
import { compiledIsomorphicReferenceAssets } from "virtual:fig-tanstack-start/payload-manifest";

export interface RenderRouterToStreamOptions {
  preloadHeader?: boolean | ServerPreloadHeaderOptions;
  request: Request;
  responseHeaders: Headers;
  router: AnyRouter;
}

export interface CreateFigStartHandlerOptions extends Omit<
  CreateStartHandlerOptions,
  "handler"
> {
  preloadHeader?: boolean | ServerPreloadHeaderOptions;
}

export function createFigStartHandler({
  preloadHeader = false,
  ...options
}: CreateFigStartHandlerOptions = {}) {
  return createStartHandler({
    ...options,
    handler: (context) => renderRouterToStream({ ...context, preloadHeader }),
  });
}

export async function renderRouterToStream({
  preloadHeader = false,
  request,
  responseHeaders,
  router,
}: RenderRouterToStreamOptions) {
  return renderRouterDocument({
    preloadHeader,
    request,
    responseHeaders,
    router,
  });
}

export function renderPayloadResponse(
  node: FigNode,
  options: Omit<
    PayloadRenderOptions,
    "clientReferenceAssets" | "componentAssets"
  > = {},
): Response {
  const payload = renderToPayloadStream(node, {
    ...options,
    clientReferenceAssets: compiledIsomorphicReferenceAssets,
    componentAssets: compiledPayloadAssets,
    signal: options.signal ?? requestAbortSignal(),
  });
  void payload.allReady.catch(() => undefined);
  return new Response(payload.stream, {
    headers: { "content-type": payload.contentType },
  });
}

// TanStack server-function handlers receive no abort signal; the incoming
// request in Start's storage context is the render's abort authority.
function requestAbortSignal(): AbortSignal | undefined {
  const context = getStartContext({ throwIfNotFound: false });
  const request =
    typeof context === "object" && context !== null
      ? (context as { request?: unknown }).request
      : undefined;
  return request instanceof Request ? request.signal : undefined;
}
