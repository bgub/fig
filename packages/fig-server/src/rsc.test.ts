import {
  clientReference,
  createContext,
  createElement,
  type ElementType,
  type FigElement,
  type FigNode,
  font,
  Fragment,
  lazy,
  modulepreload,
  preload,
  readContext,
  readPromise,
  assets,
  stylesheet,
  Suspense,
  title,
} from "@bgub/fig";
import { isValidElement } from "@bgub/fig/internal";
import { describe, expect, it } from "vite-plus/test";
import {
  createRscResponse,
  fetchRsc,
  isRscRequestCancelled,
  RscBoundary,
  type RscClientReferenceMetadata,
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
  | {
      id: number;
      tag: "client";
      value: { id: string; assets?: TestRscModel[] };
    }
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

  it("serializes stream-safe asset assets on rendered client rows", async () => {
    const Counter = clientReference({
      id: "app/Counter.client.tsx#Counter",
      load: () => Promise.resolve({}),
      assets: [
        stylesheet("/assets/Counter.css", {
          blocking: "none",
          precedence: "app",
        }),
        modulepreload("/assets/Counter.js", { key: "counter-script" }),
        stylesheet("/assets/Counter.css"), // duplicate key, dropped
        title("ignored"), // head-only, not stream-safe
      ],
    });

    const rows = await renderToRscRows(createElement(Counter, {}));
    const clientRow = rows.find((row) => row.tag === "client");

    expect(clientRow).toEqual({
      id: 1,
      tag: "client",
      value: {
        id: "app/Counter.client.tsx#Counter",
        assets: [
          {
            href: "/assets/Counter.css",
            kind: "stylesheet",
            precedence: "app",
          },
          { href: "/assets/Counter.js", kind: "modulepreload" },
        ],
      },
    });
  });

  it("serializes assets from the render-level client reference resolver", async () => {
    const Counter = clientReference({
      id: "app/Counter.client.tsx#Counter",
      load: () => Promise.resolve({}),
    });

    const rows = await renderToRscRows(createElement(Counter, {}), {
      clientReferenceAssets: ({ id }) =>
        id === "app/Counter.client.tsx#Counter"
          ? [
              stylesheet("/assets/Counter.css"),
              modulepreload("/assets/Counter.js"),
            ]
          : [],
    });

    expect(rows.find((row) => row.tag === "client")).toEqual({
      id: 1,
      tag: "client",
      value: {
        id: "app/Counter.client.tsx#Counter",
        assets: [
          { href: "/assets/Counter.css", kind: "stylesheet" },
          { href: "/assets/Counter.js", kind: "modulepreload" },
        ],
      },
    });
  });

  it("omits the assets field for client references with no assets", async () => {
    const Plain = clientReference({
      id: "app/Plain.client.tsx#Plain",
      load: () => Promise.resolve({}),
    });

    const rows = await renderToRscRows(createElement(Plain, {}));

    expect(rows.find((row) => row.tag === "client")).toEqual({
      id: 1,
      tag: "client",
      value: { id: "app/Plain.client.tsx#Plain" },
    });
  });

  it("passes only the id to client reference resolvers", async () => {
    const Counter = clientReference({
      id: "app/Counter.client.tsx#Counter",
      load: () => Promise.resolve({}),
      assets: [stylesheet("/assets/Counter.css")],
    });

    const rows = await renderToRscRows(createElement(Counter, {}));
    const seen: RscClientReferenceMetadata[] = [];
    const response = createRscResponse({
      resolveClientReference(metadata) {
        seen.push(metadata);
        return () => null;
      },
    });
    processTestRscRows(response, rows);

    // The wire row carries assets, but resolver hooks see the documented
    // { id } shape only.
    expect(seen).toEqual([{ id: "app/Counter.client.tsx#Counter" }]);
  });

  it("renders preloaded client references synchronously", async () => {
    const Widget = clientReference({
      id: "app/Widget.client.tsx#Widget",
      load: () => Promise.resolve({}),
    });
    const rows = await renderToRscRows(createElement(Widget, { label: "hi" }));

    const widgetModule = {
      Widget: (props: { label: string }) =>
        createElement("span", null, `widget:${props.label}`),
    };

    // Without preloading, the first render reads the module promise (this
    // evaluation runs outside a Fig render, so readPromise throws its
    // dispatcher error instead of suspending).
    const cold = createRscResponse({
      loadClientReference: () => Promise.resolve(widgetModule),
    });
    processTestRscRows(cold, rows);
    expect(() => evaluateRscNode(cold.getRoot())).toThrow(
      "readPromise can only be called",
    );

    // Preloading dedupes the module load and makes the render synchronous.
    let loads = 0;
    const response = createRscResponse({
      loadClientReference: () => {
        loads += 1;
        return Promise.resolve(widgetModule);
      },
    });
    processTestRscRows(response, rows);

    await response.preloadClientReferences();
    await response.preloadClientReferences();
    expect(loads).toBe(1);

    const rendered = evaluateRscNode(response.getRoot()) as FigElement;
    expect(isValidElement(rendered)).toBe(true);
    expect(rendered.type).toBe("span");
    expect(rendered.props.children).toBe("widget:hi");
  });

  it("ignores invalid asset descriptors while decoding client rows", () => {
    const response = createRscResponse();

    response.processStringChunk(
      `${JSON.stringify({
        id: 1,
        tag: "client",
        value: {
          id: "app/Counter.client.tsx#Counter",
          assets: [
            { href: "/assets/Counter.css", kind: "stylesheet" },
            { href: "/assets/Unknown.asset", kind: "unknown" },
          ],
        },
      })}\n`,
    );

    expect(response.getAssetResources()).toEqual([
      { href: "/assets/Counter.css", kind: "stylesheet" },
    ]);
  });

  it("sends explicit assets from RSC subtrees", async () => {
    const rows = await renderToRscText(
      assets(
        [stylesheet("/assets/ServerRoute.css"), preload("/mark.svg", "image")],
        createElement("article", null, "Server route"),
      ),
    );
    const response = createRscResponse();
    response.processStringChunk(rows);

    expect(response.getAssetResources()).toEqual([
      { href: "/assets/ServerRoute.css", kind: "stylesheet" },
      { as: "image", href: "/mark.svg", kind: "preload" },
    ]);
  });

  it("sends and dedupes assets only for client references that render", async () => {
    const shared = stylesheet("/assets/shared.css");
    const Header = clientReference({
      id: "app/Header.client.tsx#Header",
      load: () => Promise.resolve({}),
      assets: [shared, stylesheet("/assets/Header.css")],
    });
    const Footer = clientReference({
      id: "app/Footer.client.tsx#Footer",
      load: () => Promise.resolve({}),
      assets: [shared, stylesheet("/assets/Footer.css")],
    });
    // Defined but never rendered: must contribute nothing.
    clientReference({
      id: "app/Unused.client.tsx#Unused",
      load: () => Promise.resolve({}),
      assets: [stylesheet("/assets/Unused.css")],
    });

    const text = await renderToRscText(
      createElement(
        Fragment,
        null,
        createElement(Header, {}),
        createElement(Footer, {}),
      ),
    );

    expect(text).not.toContain("Unused.css");

    const response = createRscResponse();
    response.processStringChunk(text);

    // Shared asset deduped across the two references that rendered.
    expect(response.getAssetResources()).toEqual([
      { href: "/assets/shared.css", kind: "stylesheet" },
      { href: "/assets/Header.css", kind: "stylesheet" },
      { href: "/assets/Footer.css", kind: "stylesheet" },
    ]);
  });

  it("dedupes a font against an equivalent preload-as-font on a client row", async () => {
    const Text = clientReference({
      id: "app/Text.client.tsx#Text",
      load: () => Promise.resolve({}),
      assets: [
        font("/assets/Inter.woff2", "font/woff2"),
        // Same asset, expressed as a preload: both share the preload-font key
        // space, so only the first survives serialization.
        preload("/assets/Inter.woff2", "font", {
          type: "font/woff2",
          crossOrigin: "anonymous",
        }),
      ],
    });

    const rows = await renderToRscRows(createElement(Text, {}));

    expect(rows.find((row) => row.tag === "client")).toEqual({
      id: 1,
      tag: "client",
      value: {
        id: "app/Text.client.tsx#Text",
        assets: [
          { href: "/assets/Inter.woff2", kind: "font", type: "font/woff2" },
        ],
      },
    });
  });

  it("does not hang when a client reference resource thunk throws", async () => {
    const Broken = clientReference({
      id: "app/Broken.client.tsx#Broken",
      load: () => Promise.resolve({}),
      // A bundler-manifest thunk may throw (missing entry). Resolving assets
      // before reserving the row id surfaces this as an ordinary error row
      // instead of a reserved-but-unemitted client row that suspends forever.
      assets: () => {
        throw new Error("manifest missing");
      },
    });

    await expect(renderToRscRows(createElement(Broken, {}))).resolves.toEqual([
      { id: 0, tag: "error", value: { message: "manifest missing" } },
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

  it("rejects duplicate RSC boundary ids", async () => {
    const rows = await renderToRscRows(
      createElement(
        "section",
        null,
        createElement(RscBoundary, { id: "post" }, "First"),
        createElement(RscBoundary, { id: "post" }, "Second"),
      ),
    );

    expect(rows).toContainEqual({
      id: 1,
      tag: "error",
      value: { message: 'Duplicate RSC boundary id "post".' },
    });
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

  it("namespaces refresh-payload row ids so they cannot clobber initial chunks", async () => {
    const First = clientReference({
      id: "first",
      load: () => Promise.resolve({}),
    });
    const Second = clientReference({
      id: "second",
      load: () => Promise.resolve({}),
    });

    const response = createRscResponse({
      resolveClientReference: ({ id }) =>
        function Resolved() {
          return id;
        },
    });

    const rendered: FigNode[] = [];
    response.bindRoot({
      render(node) {
        rendered.push(node);
      },
    });

    // Initial payload: a client reference outlined to chunk 1, beside a
    // refreshable boundary.
    processTestRscRows(
      response,
      await renderToRscRows(
        createElement(
          "section",
          null,
          createElement(First, {}),
          createElement(RscBoundary, { id: "slot" }, "before"),
        ),
      ),
    );

    // Refresh the boundary with a DIFFERENT client reference. Its outlined row
    // restarts at id 1 on the server and would overwrite chunk 1 (First) in the
    // shared chunks Map without per-payload namespacing.
    response.beginRefreshPayload();
    processTestRscRows(
      response,
      await renderToRscRows(createElement(Second, {}), {
        refreshBoundary: "slot",
      }),
    );

    // First still resolves to "first" (chunk 1 intact); the boundary shows the
    // refreshed "second".
    expect(evaluateRscNode(rendered[rendered.length - 1])).toMatchObject({
      props: { children: ["first", "second"] },
      type: "section",
    });
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
