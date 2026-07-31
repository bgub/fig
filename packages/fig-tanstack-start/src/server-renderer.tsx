import {
  renderToDocumentStream,
  type ServerPreloadHeaderOptions,
} from "@bgub/fig-server";
import { RouterProvider } from "@bgub/fig-tanstack-router";
import type { AnyRouter } from "@tanstack/router-core";
import {
  createSsrStreamResponse,
  transformReadableStreamWithRouter,
} from "@tanstack/router-core/ssr/server";
import { injectPayloadDocument } from "./payload-internal.ts";
import { requireStartDataStore, startDataDocumentScript } from "./transport.ts";

export interface RenderRouterToStreamOptions {
  preloadHeader?: boolean | ServerPreloadHeaderOptions;
  request: Request;
  responseHeaders: Headers;
  router: AnyRouter;
}

// This private module is shared by the default entry and public server API.
// Keeping Payload response rendering out of the default entry prevents its
// compiled application-reference manifest from entering the SSR service.
export async function renderRouterToStream({
  preloadHeader = false,
  request,
  responseHeaders,
  router,
}: RenderRouterToStreamOptions) {
  const dataStore = requireStartDataStore(router.options.context);
  const render = renderToDocumentStream(<RouterProvider router={router} />, {
    dataStore,
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
      (payloadKeys) => startDataDocumentScript(dataStore, payloadKeys),
    );
    const routerStream = documentStream as unknown as Parameters<
      typeof transformReadableStreamWithRouter
    >[1];
    // This is a direct Web-stream chain, so cancelling the response reaches
    // the Fig render through each upstream reader. TanStack's onAbort hook is
    // only needed for producers hidden behind an adapter such as PassThrough.
    const stream = transformReadableStreamWithRouter(router, routerStream);
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
