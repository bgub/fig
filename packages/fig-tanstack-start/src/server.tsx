import { createElement } from "@bgub/fig";
import { renderToDocumentStream } from "@bgub/fig-server";
import { RouterProvider } from "@bgub/fig-tanstack-router";
import {
  createSsrStreamResponse,
  transformReadableStreamWithRouter,
} from "@tanstack/router-core/ssr/server";
import { defineHandlerCallback } from "@tanstack/start-server-core";
import type { AnyRouter } from "@tanstack/router-core";
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

  const stream = transformReadableStreamWithRouter(router, render.stream, {
    onAbort: (reason) => render.abort(reason),
  });
  responseHeaders.set("content-type", render.contentType);
  return createSsrStreamResponse(
    router,
    new Response(stream, {
      headers: responseHeaders,
      status: router.stores.statusCode.get(),
    }),
  );
}

export const defaultStreamHandler = defineHandlerCallback(renderRouterToStream);
