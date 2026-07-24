import type { FigNode } from "@bgub/fig";
import {
  renderToDocumentStream,
  type ServerPreloadHeaderOptions,
} from "@bgub/fig-server";
import {
  renderToPayloadStream,
  type PayloadRenderOptions,
} from "@bgub/fig-server/payload";
import { RouterProvider } from "@bgub/fig-tanstack-router";
import {
  createStartHandler,
  type CreateStartHandlerOptions,
} from "@tanstack/start-server-core";
import {
  createSsrStreamResponse,
  transformReadableStreamWithRouter,
} from "@tanstack/router-core/ssr/server";
import type { AnyRouter } from "@tanstack/router-core";
import { compiledPayloadAssets } from "./payload-assets.ts";
import { injectPayloadDocument } from "./payload-internal.ts";
import { getStartContext } from "./start-context.ts";
import { requireStartDataStore } from "./store.ts";
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
  const render = renderToDocumentStream(<RouterProvider router={router} />, {
    dataStore: requireStartDataStore(router.options.context),
    nonce: router.options.ssr?.nonce,
    signal: request.signal,
  });
  await render.shellReady;

  try {
    if (preloadHeader !== false) {
      const value = render.getPreloadHeader(
        preloadHeader === true ? undefined : preloadHeader,
      );
      if (value !== undefined) mergeLinkHeader(responseHeaders, value);
    }

    // Router Core and the DOM library resolve this Web stream through different
    // Node buffer generics, even though the runtime value is the same.
    const documentStream = injectPayloadDocument(
      render.stream,
      router.options.ssr?.nonce,
      render.allReady,
    );
    const routerStream = documentStream as unknown as Parameters<
      typeof transformReadableStreamWithRouter
    >[1];
    const stream = transformReadableStreamWithRouter(router, routerStream, {
      onAbort: (reason) => render.abort(reason),
    });
    responseHeaders.set("content-type", render.contentType);
    return createSsrStreamResponse(
      router,
      new Response(stream as unknown as BodyInit, {
        headers: responseHeaders,
        status: router.stores.statusCode.get(),
      }),
    );
  } catch (error) {
    render.abort(error);
    throw error;
  }
}

function mergeLinkHeader(headers: Headers, incoming: string): void {
  const current = headers.get("link");
  if (current === null) {
    headers.set("link", incoming);
    return;
  }

  const values = new Set(splitLinkHeader(current));
  for (const value of splitLinkHeader(incoming)) values.add(value);
  headers.set("link", [...values].join(", "));
}

function splitLinkHeader(value: string): string[] {
  const links: string[] = [];
  let angleDepth = 0;
  let escaped = false;
  let quoted = false;
  let start = 0;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted && character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (character === "<") {
      angleDepth += 1;
      continue;
    }
    if (character === ">") {
      angleDepth = Math.max(0, angleDepth - 1);
      continue;
    }
    if (character !== "," || angleDepth !== 0) continue;

    const link = value.slice(start, index).trim();
    if (link !== "") links.push(link);
    start = index + 1;
  }

  const link = value.slice(start).trim();
  if (link !== "") links.push(link);
  return links;
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
