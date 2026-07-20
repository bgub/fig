import { createElement, type FigNode } from "@bgub/fig";
import { renderToDocumentStream } from "@bgub/fig-server";
import {
  renderToPayloadStream,
  type PayloadRenderOptions,
} from "@bgub/fig-server/payload";
import { RouterProvider } from "@bgub/fig-tanstack-router";
import {
  createSsrStreamResponse,
  transformReadableStreamWithRouter,
} from "@tanstack/router-core/ssr/server";
import { defineHandlerCallback } from "@tanstack/start-server-core";
import type { AnyRouter } from "@tanstack/router-core";
import { injectPayloadDocument } from "./payload-internal.ts";
import { requireStartDataStore } from "./store.ts";

export interface RenderRouterToStreamOptions {
  request: Request;
  responseHeaders: Headers;
  router: AnyRouter;
}

export async function renderRouterToStream({
  request,
  responseHeaders,
  router,
}: RenderRouterToStreamOptions) {
  const render = renderToDocumentStream(
    createElement(RouterProvider, { router }),
    {
      dataStore: requireStartDataStore(router.options.context),
      nonce: router.options.ssr?.nonce,
      signal: request.signal,
    },
  );
  await render.shellReady;

  // Router Core and the DOM library resolve this Web stream through different
  // Node buffer generics, even though the runtime value is the same.
  const documentStream = injectPayloadDocument(
    render.stream,
    router.options.ssr?.nonce,
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
}

export function renderPayloadResponse(
  node: FigNode,
  options: PayloadRenderOptions = {},
): Response {
  const payload = renderToPayloadStream(node, options);
  void payload.allReady.catch(() => undefined);
  return new Response(payload.stream, {
    headers: { "content-type": payload.contentType },
  });
}

export const defaultStreamHandler = defineHandlerCallback(renderRouterToStream);
