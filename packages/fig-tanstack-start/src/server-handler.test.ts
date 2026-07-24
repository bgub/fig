import type { FigDataStoreController } from "@bgub/fig";
import type { ServerPreloadHeaderOptions } from "@bgub/fig-server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStartDataContext } from "./data.ts";

interface HandlerContext {
  request: Request;
  responseHeaders: Headers;
  router: {
    options: { context: { data: FigDataStoreController }; ssr?: never };
    stores: { statusCode: { get(): number } };
  };
}

interface StartHandlerOptions {
  handler: (context: HandlerContext) => Promise<{ response: Response }>;
}

const mocks = vi.hoisted(() => ({
  abort: vi.fn(),
  createStartHandler: vi.fn((options: StartHandlerOptions) => options.handler),
  getPreloadHeader: vi.fn(
    (): string | undefined => "</assets/app.css>; rel=preload; as=style",
  ),
  renderToDocumentStream: vi.fn(),
}));

vi.mock("@bgub/fig-server", () => ({
  renderToDocumentStream: mocks.renderToDocumentStream,
}));

vi.mock("@tanstack/start-server-core", () => ({
  createStartHandler: mocks.createStartHandler,
}));

vi.mock("@tanstack/router-core/ssr/server", () => ({
  createSsrStreamResponse: (_router: unknown, response: Response) => ({
    response,
    serverSsrCleanup: "none",
  }),
  transformReadableStreamWithRouter: (
    _router: unknown,
    stream: ReadableStream<Uint8Array>,
  ) => stream,
}));

vi.mock("./payload-internal.ts", () => ({
  injectPayloadDocument: (stream: ReadableStream<Uint8Array>) => stream,
}));

import { createFigStartHandler } from "./server.tsx";

describe("createFigStartHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.renderToDocumentStream.mockReturnValue({
      abort: mocks.abort,
      allReady: Promise.resolve(),
      contentType: "text/html; charset=utf-8",
      getPreloadHeader: mocks.getPreloadHeader,
      shellReady: Promise.resolve(),
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      }),
    });
  });

  it("leaves preload response headers disabled by default", async () => {
    const response = await invokeFactoryHandler();

    expect(response.headers.get("link")).toBeNull();
    expect(mocks.getPreloadHeader).not.toHaveBeenCalled();
  });

  it("forwards configured preload header options", async () => {
    const options: ServerPreloadHeaderOptions = {
      filter: (resource) => resource.href.startsWith("/assets/"),
      maxLength: 512,
    };
    const response = await invokeFactoryHandler(options);

    expect(mocks.getPreloadHeader).toHaveBeenCalledWith(options);
    expect(response.headers.get("link")).toBe(
      "</assets/app.css>; rel=preload; as=style",
    );
  });
});

async function invokeFactoryHandler(
  preloadHeader?: ServerPreloadHeaderOptions,
): Promise<Response> {
  createFigStartHandler({ preloadHeader });
  const options = mocks.createStartHandler.mock.calls[0]?.[0];
  if (options === undefined) throw new Error("Start handler was not created.");

  const startData = createStartDataContext();
  const result = await options.handler({
    request: new Request("https://example.test/"),
    responseHeaders: new Headers(),
    router: {
      options: { context: startData.context },
      stores: { statusCode: { get: () => 200 } },
    },
  });
  startData.context.data.dispose();
  return result.response;
}
