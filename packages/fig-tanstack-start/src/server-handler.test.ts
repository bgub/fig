import type { FigDataStoreController } from "@bgub/fig";
import type { ServerPreloadHeaderOptions } from "@bgub/fig-server";
import {
  setResponseHeader,
  setResponseStatus,
} from "@tanstack/start-server-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStartDataContext } from "./data.ts";

interface HandlerContext {
  request: Request;
  responseHeaders: Headers;
  router: {
    options: { context: { data: FigDataStoreController }; ssr?: never };
    _serverResult: { type: "render"; status: 200 };
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

vi.mock("@tanstack/start-server-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/start-server-core")>()),
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

  it("keeps custom entries returning error responses without another wrapper", async () => {
    mocks.createStartHandler.mockReturnValueOnce(async () => {
      setResponseStatus(503);
      setResponseHeader("retry-after", "60");
      throw new Error("private server detail");
    });

    const fetch = createFigStartHandler();
    const response = await fetch(new Request("https://example.test/"));

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.text()).not.toContain("private server detail");
  });

  it("keeps custom entries returning thrown responses", async () => {
    const response = new Response("denied", { status: 401 });
    mocks.createStartHandler.mockReturnValueOnce(async () => {
      throw response;
    });

    const fetch = createFigStartHandler();

    expect(await fetch(new Request("https://example.test/"))).toBe(response);
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
      _serverResult: { type: "render", status: 200 },
    },
  });
  startData.context.data.dispose();
  return result.response;
}
