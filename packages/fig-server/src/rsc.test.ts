import {
  clientReference,
  createContext,
  createElement,
  type ElementType,
  type FigElement,
  type FigNode,
  Fragment,
  lazy,
  isValidElement,
  readContext,
  readPromise,
  Suspense,
} from "@bgub/fig";
import { describe, expect, it } from "vite-plus/test";
import {
  createRscResponse,
  fetchRsc,
  isRscRequestCancelled,
  RscBoundary,
  type RscFetch,
  renderToRscStream,
} from "./rsc.ts";

type TestRscModel =
  | null
  | boolean
  | number
  | string
  | TestRscModel[]
  | { [key: string]: TestRscModel };

type TestRscRow =
  | { id: number; tag: "client"; value: { id: string } }
  | { id: number; tag: "error"; value: { message: string } }
  | { id: number; tag: "model"; value: TestRscModel }
  | { boundary: string; tag: "refresh"; value: TestRscModel };

interface TestRscElementModel {
  $fig: "element";
  key: string | number | null;
  props: Record<string, TestRscModel>;
  type: TestRscModel;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve: Deferred<T>["resolve"] = () => undefined;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) return output + decoder.decode();
    output += decoder.decode(value, { stream: true });
  }
}

function streamFromString(input: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(input));
      controller.close();
    },
  });
}

function controlledTextStream(): {
  close(): void;
  stream: ReadableStream<Uint8Array>;
  write(chunk: string): void;
} {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;

  return {
    close() {
      controller?.close();
    },
    stream: new ReadableStream<Uint8Array>({
      start(innerController) {
        controller = innerController;
      },
    }),
    write(chunk) {
      controller?.enqueue(encoder.encode(chunk));
    },
  };
}

function requireHeaders(headers: Headers | null): Headers {
  if (headers === null) throw new Error("Expected request headers.");
  return headers;
}

async function renderToRscText(
  node: FigNode,
  options?: Parameters<typeof renderToRscStream>[1],
): Promise<string> {
  const result = renderToRscStream(node, options);
  await result.allReady;
  return readStream(result.stream);
}

async function renderToRscRows(
  node: FigNode,
  options?: Parameters<typeof renderToRscStream>[1],
): Promise<TestRscRow[]> {
  return parseTestRscRows(await renderToRscText(node, options));
}

function parseTestRscRows(input: string): TestRscRow[] {
  return input
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as TestRscRow);
}

function decodeTestRscRows(
  rows: TestRscRow[],
  options?: Parameters<typeof createRscResponse>[0],
): FigNode {
  const response = createRscResponse(options);
  processTestRscRows(response, rows);
  return response.getRoot();
}

function processTestRscRows(
  response: ReturnType<typeof createRscResponse>,
  rows: TestRscRow[],
): void {
  response.processStringChunk(
    `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
  );
}

async function processTestRscStream(
  response: ReturnType<typeof createRscResponse>,
  stream: ReadableStream<Uint8Array>,
): Promise<void> {
  await readTextStream(stream, (chunk) => response.processStringChunk(chunk));
  response.processStringChunk("\n");
}

async function readTextStream(
  stream: ReadableStream<Uint8Array>,
  onChunk: (chunk: string) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      onChunk(decoder.decode());
      return;
    }

    onChunk(decoder.decode(value, { stream: true }));
  }
}

function evaluateRscNode(node: FigNode): FigNode {
  if (Array.isArray(node)) return node.map((child) => evaluateRscNode(child));
  if (!isValidElement(node)) return node;
  if (node.type === Fragment) return evaluateRscNode(node.props.children);

  if (typeof node.type === "function") {
    return evaluateRscNode(
      (node.type as ElementType & ((props: FigElement["props"]) => FigNode))(
        node.props,
      ),
    );
  }

  return {
    ...node,
    props: {
      ...node.props,
      children: evaluateRscNode(node.props.children),
    },
  };
}

function unwrapFunctionComponent(node: FigNode): FigNode {
  if (!isValidElement(node) || typeof node.type !== "function") return node;

  return (node.type as ElementType & ((props: FigElement["props"]) => FigNode))(
    node.props,
  );
}

describe("RSC rendering", () => {
  it("serializes client references with normal JSX props", async () => {
    const LikeButton = clientReference<{
      initialCount: number;
      tone?: string;
    }>({
      id: "app/LikeButton.client.tsx#LikeButton",
      load: () => Promise.resolve({}),
    });

    const rows = await renderToRscRows(
      createElement(LikeButton, { initialCount: 12, tone: "primary" }),
    );

    expect(rows).toEqual([
      {
        id: 1,
        tag: "client",
        value: { id: "app/LikeButton.client.tsx#LikeButton" },
      },
      {
        id: 0,
        tag: "model",
        value: {
          $fig: "element",
          key: null,
          props: { initialCount: 12, tone: "primary" },
          type: { $fig: "client", id: 1 },
        },
      },
    ]);
  });

  it("renders server components before passing them as client props", async () => {
    const Card = clientReference<{ header: unknown; children?: unknown }>({
      id: "app/Card.client.tsx#Card",
      load: () => Promise.resolve({}),
    });

    function Header() {
      return createElement("h2", null, "Server header");
    }

    const rows = await renderToRscRows(
      createElement(
        Card,
        { header: createElement(Header, null) },
        createElement("p", null, "Server child"),
      ),
    );
    const root = rows.find(
      (row) => "id" in row && row.id === 0,
    ) as TestRscRow & {
      tag: "model";
      value: TestRscElementModel;
    };

    expect(root.value.props.header).toEqual({
      $fig: "element",
      key: null,
      props: { children: "Server header" },
      type: "h2",
    });
    expect(root.value.props.children).toEqual({
      $fig: "element",
      key: null,
      props: { children: "Server child" },
      type: "p",
    });
  });

  it("streams suspended server subtrees as lazy rows", async () => {
    const pending = deferred<string>();

    function Message() {
      return createElement("span", null, readPromise(pending.promise));
    }

    const result = renderToRscStream(
      createElement("div", null, "Before ", createElement(Message, null)),
    );

    pending.resolve("Ready");
    await result.allReady;

    const rows = parseTestRscRows(await readStream(result.stream));

    expect(rows).toEqual([
      {
        id: 0,
        tag: "model",
        value: {
          $fig: "element",
          key: null,
          props: {
            children: ["Before ", { $fig: "lazy", id: 1 }],
          },
          type: "div",
        },
      },
      {
        id: 1,
        tag: "model",
        value: {
          $fig: "element",
          key: null,
          props: { children: "Ready" },
          type: "span",
        },
      },
    ]);
  });

  it("streams lazy component loaders as lazy rows", async () => {
    function Message() {
      return createElement("span", null, "Lazy ready");
    }

    const pending = deferred<typeof Message>();
    const LazyMessage = lazy(() => pending.promise);
    const result = renderToRscStream(
      createElement("div", null, createElement(LazyMessage, null)),
    );

    pending.resolve(Message);
    await result.allReady;

    const rows = parseTestRscRows(await readStream(result.stream));

    expect(rows).toEqual([
      {
        id: 0,
        tag: "model",
        value: {
          $fig: "element",
          key: null,
          props: { children: { $fig: "lazy", id: 1 } },
          type: "div",
        },
      },
      {
        id: 1,
        tag: "model",
        value: {
          $fig: "element",
          key: null,
          props: { children: "Lazy ready" },
          type: "span",
        },
      },
    ]);
  });

  it("serializes promise props distinctly from lazy node slots", async () => {
    const pending = deferred<string>();
    const Viewer = clientReference<{ value: Promise<string> }>({
      id: "app/Viewer.client.tsx#Viewer",
      load: () => Promise.resolve({}),
    });

    const result = renderToRscStream(
      createElement(Viewer, { value: pending.promise }),
    );

    pending.resolve("Ready");
    await result.allReady;

    expect(parseTestRscRows(await readStream(result.stream))).toEqual([
      { id: 1, tag: "client", value: { id: "app/Viewer.client.tsx#Viewer" } },
      {
        id: 0,
        tag: "model",
        value: {
          $fig: "element",
          key: null,
          props: { value: { $fig: "promise", id: 2 } },
          type: { $fig: "client", id: 1 },
        },
      },
      { id: 2, tag: "model", value: "Ready" },
    ]);
  });

  it("keeps Fig context available while rendering server components", async () => {
    const Theme = createContext("light");

    function Badge() {
      return createElement("span", null, readContext(Theme));
    }

    await expect(
      renderToRscText(
        createElement(Theme, { value: "dark" }, createElement(Badge, null)),
      ),
    ).resolves.toContain('"children":"dark"');
  });

  it("uses Suspense as a client-visible element around lazy server children", async () => {
    const pending = deferred<string>();

    function Message() {
      return createElement("span", null, readPromise(pending.promise));
    }

    const result = renderToRscStream(
      createElement(
        Suspense,
        { fallback: createElement("em", null, "Loading") },
        createElement(Message, null),
      ),
    );

    pending.resolve("Ready");
    await result.allReady;

    const rows = parseTestRscRows(await readStream(result.stream));
    expect(rows[0]).toEqual({
      id: 0,
      tag: "model",
      value: {
        $fig: "element",
        key: null,
        props: {
          children: { $fig: "lazy", id: 1 },
          fallback: {
            $fig: "element",
            key: null,
            props: { children: "Loading" },
            type: "em",
          },
        },
        type: { $fig: "suspense" },
      },
    });
  });

  it("decodes completed rows back into Fig nodes", async () => {
    const LikeButton = clientReference<{ initialCount: number }>({
      id: "app/LikeButton.client.tsx#LikeButton",
      load: () => Promise.resolve({}),
    });

    const rows = await renderToRscRows(
      createElement(LikeButton, { initialCount: 12 }),
    );
    function ClientLikeButton() {
      return null;
    }

    const node = decodeTestRscRows(rows, {
      resolveClientReference() {
        return ClientLikeButton;
      },
    });

    expect(unwrapFunctionComponent(node)).toMatchObject({
      key: null,
      props: { initialCount: 12 },
      type: ClientLikeButton,
    });
  });

  it("rejects functions passed across the server-to-client boundary", async () => {
    const Button = clientReference<{ action: () => void }>({
      id: "app/Button.client.tsx#Button",
      load: () => Promise.resolve({}),
    });

    await expect(
      renderToRscRows(createElement(Button, { action: () => undefined })),
    ).resolves.toEqual([
      { id: 1, tag: "client", value: { id: "app/Button.client.tsx#Button" } },
      {
        id: 0,
        tag: "error",
        value: { message: "Functions cannot be passed to Client Components." },
      },
    ]);
  });

  it("marks refreshable RSC boundaries in the model", async () => {
    const rows = await renderToRscRows(
      createElement(
        "section",
        null,
        createElement(
          RscBoundary,
          { id: "post" },
          createElement("p", null, "Initial"),
        ),
      ),
    );

    expect(rows).toEqual([
      {
        id: 0,
        tag: "model",
        value: {
          $fig: "element",
          key: null,
          props: {
            children: {
              $fig: "boundary",
              child: {
                $fig: "element",
                key: null,
                props: { children: "Initial" },
                type: "p",
              },
              id: "post",
            },
          },
          type: "section",
        },
      },
    ]);
  });

  it("renders boundary refresh rows", async () => {
    await expect(
      renderToRscRows(createElement("p", null, "Updated"), {
        refreshBoundary: "post",
      }),
    ).resolves.toEqual([
      {
        boundary: "post",
        tag: "refresh",
        value: {
          $fig: "element",
          key: null,
          props: { children: "Updated" },
          type: "p",
        },
      },
    ]);
  });

  it("processes streamed rows incrementally", async () => {
    const response = createRscResponse();
    let notifications = 0;
    response.subscribe(() => {
      notifications += 1;
    });

    response.processStringChunk('{"id":0,"tag":"model"');
    expect(notifications).toBe(0);

    response.processStringChunk(',"value":"Ready"}\n');
    expect(notifications).toBe(1);
    expect(evaluateRscNode(response.getRoot())).toBe("Ready");
  });

  it("binds refresh rows to a normal Fig root render handle", async () => {
    const response = createRscResponse();
    const rendered: FigNode[] = [];
    const unsubscribe = response.bindRoot({
      render(node) {
        rendered.push(node);
      },
    });

    processTestRscRows(
      response,
      await renderToRscRows(
        createElement(
          "section",
          null,
          createElement(
            RscBoundary,
            { id: "post" },
            createElement("p", null, "Initial"),
          ),
        ),
      ),
    );
    processTestRscRows(
      response,
      await renderToRscRows(createElement("p", null, "Updated"), {
        refreshBoundary: "post",
      }),
    );

    const evaluated = evaluateRscNode(rendered[rendered.length - 1]);

    expect(rendered).toHaveLength(3);
    expect(evaluated).toMatchObject({
      props: {
        children: {
          props: { children: "Updated" },
          type: "p",
        },
      },
      type: "section",
    });

    unsubscribe();
  });

  it("pipes readable streams into an RSC response", async () => {
    const response = createRscResponse();
    await processTestRscStream(
      response,
      streamFromString(await renderToRscText(createElement("p", null, "Hi"))),
    );

    expect(evaluateRscNode(response.getRoot())).toMatchObject({
      props: { children: "Hi" },
      type: "p",
    });
  });

  it("flushes a final RSC row without a trailing newline", async () => {
    const response = createRscResponse();
    await processTestRscStream(
      response,
      streamFromString('{"id":0,"tag":"model","value":"Done"}'),
    );

    expect(evaluateRscNode(response.getRoot())).toBe("Done");
  });

  it("fetches initial RSC streams with an RSC accept header", async () => {
    const response = createRscResponse();
    let requestHeaders: Headers | null = null;
    let requestSignal: AbortSignal | null = null;
    const controller = new AbortController();
    const fetchImpl: RscFetch = async (_input, init) => {
      requestHeaders = new Headers(init?.headers);
      requestSignal = init?.signal ?? null;
      return new Response(
        await renderToRscText(createElement("p", null, "Fetched")),
        {
          headers: { "content-type": "text/x-component; charset=utf-8" },
        },
      );
    };

    await fetchRsc(response, "/rsc", {
      fetch: fetchImpl,
      signal: controller.signal,
    });

    expect(requireHeaders(requestHeaders).get("accept")).toBe(
      "text/x-component; charset=utf-8",
    );
    expect(requestSignal).toBe(controller.signal);
    expect(evaluateRscNode(response.getRoot())).toMatchObject({
      props: { children: "Fetched" },
      type: "p",
    });
  });

  it("cancels initial RSC fetches before mutating the response", async () => {
    const response = createRscResponse();
    const controller = new AbortController();
    let fetches = 0;
    let notifications = 0;
    response.subscribe(() => {
      notifications += 1;
    });

    controller.abort();

    let error: unknown;
    try {
      await fetchRsc(response, "/rsc", {
        fetch: async () => {
          fetches += 1;
          return new Response("unreachable");
        },
        signal: controller.signal,
      });
    } catch (caught) {
      error = caught;
    }

    expect(isRscRequestCancelled(error)).toBe(true);
    expect(fetches).toBe(0);
    expect(notifications).toBe(0);
  });

  it("cancels partial RSC streams without flushing buffered rows", async () => {
    const response = createRscResponse();
    const stream = controlledTextStream();
    const controller = new AbortController();
    let notifications = 0;
    response.subscribe(() => {
      notifications += 1;
    });

    const request = fetchRsc(response, "/rsc", {
      fetch: async () => new Response(stream.stream),
      signal: controller.signal,
    });
    await Promise.resolve();

    stream.write('{"id":0,"tag":"model","value":"Partial"');
    controller.abort();

    let error: unknown;
    try {
      await request;
    } catch (caught) {
      error = caught;
    }

    expect(isRscRequestCancelled(error)).toBe(true);
    expect(notifications).toBe(0);
  });

  it("fetches boundary refresh streams with the boundary header", async () => {
    const response = createRscResponse();
    let requestHeaders: Headers | null = null;
    const fetchImpl: RscFetch = async (_input, init) => {
      requestHeaders = new Headers(init?.headers);
      return new Response(
        await renderToRscText(createElement("p", null, "Fetched refresh"), {
          refreshBoundary: "post",
        }),
      );
    };
    const rendered: FigNode[] = [];
    response.bindRoot({
      render(node) {
        rendered.push(node);
      },
    });

    processTestRscRows(
      response,
      await renderToRscRows(
        createElement(
          "section",
          null,
          createElement(
            RscBoundary,
            { id: "post" },
            createElement("p", null, "Initial"),
          ),
        ),
      ),
    );
    await fetchRsc(response, "/rsc/post", {
      fetch: fetchImpl,
      headers: { accept: "custom/rsc" },
      refreshBoundary: "post",
    });

    const headers = requireHeaders(requestHeaders);
    expect(headers.get("accept")).toBe("custom/rsc");
    expect(headers.get("x-fig-rsc-boundary")).toBe("post");
    expect(evaluateRscNode(rendered[rendered.length - 1])).toMatchObject({
      props: {
        children: {
          props: { children: "Fetched refresh" },
          type: "p",
        },
      },
      type: "section",
    });
  });

  it("cancels boundary refresh streams without replacing existing content", async () => {
    const response = createRscResponse();
    const stream = controlledTextStream();
    const controller = new AbortController();
    const rendered: FigNode[] = [];
    response.bindRoot({
      render(node) {
        rendered.push(node);
      },
    });

    processTestRscRows(
      response,
      await renderToRscRows(
        createElement(
          "section",
          null,
          createElement(
            RscBoundary,
            { id: "post" },
            createElement("p", null, "Initial"),
          ),
        ),
      ),
    );

    const request = fetchRsc(response, "/rsc/post", {
      fetch: async () => new Response(stream.stream),
      refreshBoundary: "post",
      signal: controller.signal,
    });
    await Promise.resolve();

    stream.write('{"boundary":"post","tag":"refresh","value":');
    controller.abort();

    let error: unknown;
    try {
      await request;
    } catch (caught) {
      error = caught;
    }

    expect(isRscRequestCancelled(error)).toBe(true);
    expect(evaluateRscNode(rendered[rendered.length - 1])).toMatchObject({
      props: {
        children: {
          props: { children: "Initial" },
          type: "p",
        },
      },
      type: "section",
    });
  });

  it("rejects failed RSC fetches before mutating the response", async () => {
    const response = createRscResponse();
    let notifications = 0;
    response.subscribe(() => {
      notifications += 1;
    });

    await expect(
      fetchRsc(response, "/rsc", {
        fetch: async () => new Response("nope", { status: 500 }),
      }),
    ).rejects.toThrow("RSC request failed with status 500.");
    expect(notifications).toBe(0);
  });

  it("rejects malformed RSC streams as real failures", async () => {
    const response = createRscResponse();

    await expect(
      fetchRsc(response, "/rsc", {
        fetch: async () => new Response(streamFromString("{not-json}\n")),
      }),
    ).rejects.toThrow(SyntaxError);
  });
});
