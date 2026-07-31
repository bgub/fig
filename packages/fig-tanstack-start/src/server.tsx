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
import { compiledPayloadAssets } from "./payload-assets.ts";
import {
  renderRouterToStream,
  type RenderRouterToStreamOptions,
} from "./server-renderer.tsx";
import { getStartContext } from "./start-context.ts";
import { compiledIsomorphicReferenceAssets } from "virtual:fig-tanstack-start/payload-manifest";

export { renderRouterToStream };
export type { RenderRouterToStreamOptions };

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
    handler:
      preloadHeader === false
        ? renderRouterToStream
        : (context) => renderRouterToStream({ ...context, preloadHeader }),
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
    (typeof context === "object" || typeof context === "function") &&
    context !== null
      ? Reflect.get(context, "request")
      : undefined;
  return request instanceof Request ? request.signal : undefined;
}
