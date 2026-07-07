import {
  assets,
  clientReference,
  createContext,
  createElement,
  type ElementType,
  type FigElement,
  type FigNode,
  Fragment,
  font,
  lazy,
  modulepreload,
  preload,
  readContext,
  readPromise,
  Suspense,
  stylesheet,
  title,
} from "@bgub/fig";
import {
  isValidElement,
  readThenable,
  setCurrentDispatcher,
} from "@bgub/fig/internal";
import { describe, expect, it } from "vite-plus/test";
import {
  createPayloadResponse,
  fetchPayload,
  isPayloadRequestCancelled,
  jsonPayloadCodec,
  PayloadBoundary,
  type PayloadClientReferenceMetadata,
  type PayloadFetch,
  renderToPayloadStream,
} from "./payload.ts";
import { createStaticDispatcher, deferred } from "./shared.ts";
import {
  controlledTextStream,
  readStream,
  streamFromString,
} from "./test-utils.ts";

// The cancellation test observes Node's unhandled-rejection reporting; the
// package compiles without @types/node, so declare the two hooks it uses.
declare const process: {
  on(event: "unhandledRejection", listener: (reason: unknown) => void): void;
  off(event: "unhandledRejection", listener: (reason: unknown) => void): void;
};

type TestPayloadModel =
  | null
  | boolean
  | number
  | string
  | TestPayloadModel[]
  | { [key: string]: TestPayloadModel };

type TestPayloadRow =
  | {
      id: number;
      tag: "client";
      value: { id: string; assets?: TestPayloadModel[] };
    }
  | { id: number; tag: "error"; value: { digest?: string; message?: string } }
  | { id: number; tag: "model"; value: TestPayloadModel }
  | {
      boundary: string;
      tag: "refresh-error";
      value: { digest?: string; message?: string };
    }
  | { boundary: string; tag: "refresh"; value: TestPayloadModel };

interface TestPayloadElementModel {
  $fig: "element";
  key: string | number | null;
  props: Record<string, TestPayloadModel>;
  type: TestPayloadModel;
}

function requireHeaders(headers: Headers | null): Headers {
  if (headers === null) throw new Error("Expected request headers.");
  return headers;
}

async function renderToPayloadText(
  node: FigNode,
  options?: Parameters<typeof renderToPayloadStream>[1],
): Promise<string> {
  const result = renderToPayloadStream(node, options);
  await result.allReady;
  return readStream(result.stream);
}

async function renderToPayloadRows(
  node: FigNode,
  options?: Parameters<typeof renderToPayloadStream>[1],
): Promise<TestPayloadRow[]> {
  return parseTestPayloadRows(await renderToPayloadText(node, options));
}

function parseTestPayloadRows(input: string): TestPayloadRow[] {
  return input
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as TestPayloadRow);
}

function decodeTestPayloadRows(
  rows: TestPayloadRow[],
  options?: Parameters<typeof createPayloadResponse>[0],
): FigNode {
  const response = createPayloadResponse(options);
  processTestPayloadRows(response, rows);
  return response.getRoot();
}

function processStreamInto(
  response: ReturnType<typeof createPayloadResponse>,
  stream: ReadableStream<Uint8Array>,
): Promise<void> {
  return response.processStream(stream);
}

function processTestPayloadRows(
  response: ReturnType<typeof createPayloadResponse>,
  rows: TestPayloadRow[],
): void {
  response.processStringChunk(
    `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
  );
}

function evaluatePayloadNode(node: FigNode): FigNode {
  if (Array.isArray(node))
    return node.map((child) => evaluatePayloadNode(child));
  if (!isValidElement(node)) return node;
  if (node.type === Fragment) return evaluatePayloadNode(node.props.children);

  if (typeof node.type === "function") {
    return evaluatePayloadNode(
      (node.type as ElementType & ((props: FigElement["props"]) => FigNode))(
        node.props,
      ),
    );
  }

  return {
    ...node,
    props: {
      ...node.props,
      children: evaluatePayloadNode(node.props.children),
    },
  };
}

function readPayloadRoot(response: ReturnType<typeof createPayloadResponse>) {
  const root = response.getRoot();
  if (!isValidElement(root) || typeof root.type !== "function") {
    throw new Error("Expected payload response root.");
  }
  return (root.type as ElementType & ((props: FigElement["props"]) => FigNode))(
    root.props,
  );
}

function unwrapFunctionComponent(node: FigNode): FigNode {
  if (!isValidElement(node) || typeof node.type !== "function") return node;

  return (node.type as ElementType & ((props: FigElement["props"]) => FigNode))(
    node.props,
  );
}

describe("payload rendering", () => {
  it("serializes client references with normal JSX props", async () => {
    const LikeButton = clientReference<{
      initialCount: number;
      tone?: string;
    }>({
      id: "app/LikeButton.client.tsx#LikeButton",
      load: () => Promise.resolve({}),
    });

    const rows = await renderToPayloadRows(
      createElement(LikeButton, { initialCount: 12, tone: "primary" }),
    );

    expect(rows).toEqual([
      {
        id: 1,
        tag: "client",
        value: {
          id: "app/LikeButton.client.tsx#LikeButton",
          exportName: "LikeButton",
        },
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

    const rows = await renderToPayloadRows(createElement(Counter, {}));
    const clientRow = rows.find((row) => row.tag === "client");

    expect(clientRow).toEqual({
      id: 1,
      tag: "client",
      value: {
        id: "app/Counter.client.tsx#Counter",
        exportName: "Counter",
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

    const rows = await renderToPayloadRows(createElement(Counter, {}), {
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
        exportName: "Counter",
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

    const rows = await renderToPayloadRows(createElement(Plain, {}));

    expect(rows.find((row) => row.tag === "client")).toEqual({
      id: 1,
      tag: "client",
      value: { id: "app/Plain.client.tsx#Plain", exportName: "Plain" },
    });
  });

  it("passes reference metadata without assets to client reference resolvers", async () => {
    const Counter = clientReference({
      id: "app/Counter.client.tsx#Counter",
      load: () => Promise.resolve({}),
      assets: [stylesheet("/assets/Counter.css")],
    });

    const rows = await renderToPayloadRows(createElement(Counter, {}));
    const seen: PayloadClientReferenceMetadata[] = [];
    const response = createPayloadResponse({
      resolveClientReference(metadata) {
        seen.push(metadata);
        return () => null;
      },
    });
    processTestPayloadRows(response, rows);

    // The wire row carries assets, but resolver hooks see the documented
    // metadata shape only.
    expect(seen).toEqual([
      { id: "app/Counter.client.tsx#Counter", exportName: "Counter" },
    ]);
  });

  it("renders preloaded client references synchronously", async () => {
    const Widget = clientReference({
      id: "app/Widget.client.tsx#Widget",
      load: () => Promise.resolve({}),
    });
    const rows = await renderToPayloadRows(
      createElement(Widget, { label: "hi" }),
    );

    const widgetModule = {
      Widget: (props: { label: string }) =>
        createElement("span", null, `widget:${props.label}`),
    };

    // Render under a minimal dispatcher, as a real renderer would.
    const dispatcher = createStaticDispatcher({
      contextValues: new Map(),
      externalStoreError: "no external store",
      preloadData: () => undefined,
      readData: () => {
        throw new Error("no data store");
      },
      readPromise: readThenable,
      updateError: "no updates",
      useId: () => "test",
    });

    setCurrentDispatcher(dispatcher);
    try {
      // Before the module settles, the first render read suspends.
      const cold = createPayloadResponse({
        loadClientReference: () => Promise.resolve(widgetModule),
      });
      processTestPayloadRows(cold, rows);
      let thrown: unknown;
      try {
        evaluatePayloadNode(cold.getRoot());
      } catch (error) {
        thrown = error;
      }
      expect(typeof (thrown as PromiseLike<unknown>).then).toBe("function");

      // Preloading dedupes the module load and makes the render synchronous.
      let loads = 0;
      const response = createPayloadResponse({
        loadClientReference: () => {
          loads += 1;
          return Promise.resolve(widgetModule);
        },
      });
      processTestPayloadRows(response, rows);

      await response.preloadClientReferences();
      await response.preloadClientReferences();
      expect(loads).toBe(1);

      const rendered = evaluatePayloadNode(response.getRoot()) as FigElement;
      expect(isValidElement(rendered)).toBe(true);
      expect(rendered.type).toBe("span");
      expect(rendered.props.children).toBe("widget:hi");
    } finally {
      setCurrentDispatcher(null);
    }
  });

  it("ignores invalid asset descriptors while decoding client rows", () => {
    const response = createPayloadResponse();

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

  it("sends explicit assets from payload subtrees", async () => {
    const rows = await renderToPayloadText(
      assets(
        [stylesheet("/assets/ServerRoute.css"), preload("/mark.svg", "image")],
        createElement("article", null, "Server route"),
      ),
    );
    const response = createPayloadResponse();
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

    const text = await renderToPayloadText(
      createElement(
        Fragment,
        null,
        createElement(Header, {}),
        createElement(Footer, {}),
      ),
    );

    expect(text).not.toContain("Unused.css");

    const response = createPayloadResponse();
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

    const rows = await renderToPayloadRows(createElement(Text, {}));

    expect(rows.find((row) => row.tag === "client")).toEqual({
      id: 1,
      tag: "client",
      value: {
        id: "app/Text.client.tsx#Text",
        exportName: "Text",
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

    await expect(
      renderToPayloadRows(createElement(Broken, {})),
    ).resolves.toEqual([
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

    const rows = await renderToPayloadRows(
      createElement(
        Card,
        { header: createElement(Header, null) },
        createElement("p", null, "Server child"),
      ),
    );
    const root = rows.find(
      (row) => "id" in row && row.id === 0,
    ) as TestPayloadRow & {
      tag: "model";
      value: TestPayloadElementModel;
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

    const result = renderToPayloadStream(
      createElement("div", null, "Before ", createElement(Message, null)),
    );

    pending.resolve("Ready");
    await result.allReady;

    const rows = parseTestPayloadRows(await readStream(result.stream));

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
    const result = renderToPayloadStream(
      createElement("div", null, createElement(LazyMessage, null)),
    );

    pending.resolve(Message);
    await result.allReady;

    const rows = parseTestPayloadRows(await readStream(result.stream));

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

    const result = renderToPayloadStream(
      createElement(Viewer, { value: pending.promise }),
    );

    pending.resolve("Ready");
    await result.allReady;

    expect(parseTestPayloadRows(await readStream(result.stream))).toEqual([
      {
        id: 1,
        tag: "client",
        value: { id: "app/Viewer.client.tsx#Viewer", exportName: "Viewer" },
      },
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

  it("round-trips built-in payload values through the JSON codec", async () => {
    const Viewer = clientReference<{ value: unknown }>({
      id: "app/Viewer.client.tsx#Viewer",
      load: () => Promise.resolve({}),
    });
    const date = new Date("2026-07-06T12:34:56.789Z");
    const symbol = Symbol.for("fig.payload.test");
    const payload = {
      bigint: 12345678901234567890n,
      date,
      map: new Map<unknown, unknown>([
        ["date", date],
        [symbol, new Set([NaN, Infinity])],
      ]),
      numbers: [NaN, -0, Infinity, -Infinity],
      object: { $fig: "literal", value: undefined },
      symbol,
    };

    const rows = await renderToPayloadRows(
      createElement(Viewer, { value: payload }),
    );
    const response = createPayloadResponse({
      resolveClientReference: () => "fig-viewer",
    });
    processTestPayloadRows(response, rows);

    const decoded = readPayloadRoot(response);
    if (!isValidElement(decoded)) throw new Error("Expected decoded element.");
    const value = decoded.props.value as typeof payload;

    expect(value.bigint).toBe(12345678901234567890n);
    expect(value.date).toEqual(date);
    expect(value.symbol).toBe(symbol);
    expect(value.object).toEqual({ $fig: "literal", value: undefined });
    expect(value.map.get("date")).toEqual(date);

    const decodedSet = value.map.get(symbol) as Set<number>;
    expect(Number.isNaN([...decodedSet][0])).toBe(true);
    expect(decodedSet.has(Infinity)).toBe(true);
    expect(Number.isNaN(value.numbers[0])).toBe(true);
    expect(Object.is(value.numbers[1], -0)).toBe(true);
    expect(value.numbers[2]).toBe(Infinity);
    expect(value.numbers[3]).toBe(-Infinity);
  });

  it("reports invalid Date payload values as root errors", async () => {
    const Viewer = clientReference<{ value: unknown }>({
      id: "app/Viewer.client.tsx#Viewer",
      load: () => Promise.resolve({}),
    });

    await expect(
      renderToPayloadRows(
        createElement(Viewer, { value: new Date(Number.NaN) }),
      ),
    ).resolves.toEqual([
      {
        id: 1,
        tag: "client",
        value: { exportName: "Viewer", id: "app/Viewer.client.tsx#Viewer" },
      },
      {
        id: 0,
        tag: "error",
        value: { message: "Invalid Date values cannot be serialized." },
      },
    ]);
  });

  it("decodes escaped $fig props with nested payload models", async () => {
    const Viewer = clientReference<{
      $fig: string;
      child: FigNode;
      promise: Promise<string>;
    }>({
      id: "app/Viewer.client.tsx#Viewer",
      load: () => Promise.resolve({}),
    });
    const value = Promise.resolve("Loaded");

    const rows = await renderToPayloadRows(
      createElement(Viewer, {
        $fig: "literal",
        child: createElement("span", null, "Child"),
        promise: value,
      }),
    );
    const response = createPayloadResponse({
      resolveClientReference: () => "fig-viewer",
    });
    processTestPayloadRows(response, rows);

    const decoded = readPayloadRoot(response);
    if (!isValidElement(decoded)) throw new Error("Expected decoded element.");

    expect(decoded.props.$fig).toBe("literal");
    expect(decoded.props.child).toMatchObject({
      props: { children: "Child" },
      type: "span",
    });
    expect(decoded.props.promise).toBeInstanceOf(Promise);
  });

  it("rejects payload codec mismatches during fetch", async () => {
    const response = createPayloadResponse({
      codec: {
        ...jsonPayloadCodec,
        contentType: "text/x-fig-payload; codec=custom; charset=utf-8",
        id: "custom",
      },
    });

    await expect(
      fetchPayload(response, "/payload", {
        fetch: async () =>
          new Response(
            await renderToPayloadText(createElement("p", null, "Fetched")),
            { headers: { "content-type": jsonPayloadCodec.contentType } },
          ),
      }),
    ).rejects.toThrow(
      'Payload codec mismatch: response used "json" but this client expects "custom".',
    );
  });

  it("keeps Fig context available while rendering server components", async () => {
    const Theme = createContext("light");

    function Badge() {
      return createElement("span", null, readContext(Theme));
    }

    await expect(
      renderToPayloadText(
        createElement(Theme, { value: "dark" }, createElement(Badge, null)),
      ),
    ).resolves.toContain('"children":"dark"');
  });

  it("uses Suspense as a client-visible element around lazy server children", async () => {
    const pending = deferred<string>();

    function Message() {
      return createElement("span", null, readPromise(pending.promise));
    }

    const result = renderToPayloadStream(
      createElement(
        Suspense,
        { fallback: createElement("em", null, "Loading") },
        createElement(Message, null),
      ),
    );

    pending.resolve("Ready");
    await result.allReady;

    const rows = parseTestPayloadRows(await readStream(result.stream));
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

    const rows = await renderToPayloadRows(
      createElement(LikeButton, { initialCount: 12 }),
    );
    function ClientLikeButton() {
      return null;
    }

    const node = decodeTestPayloadRows(rows, {
      resolveClientReference() {
        return ClientLikeButton;
      },
    });

    expect(
      unwrapFunctionComponent(unwrapFunctionComponent(node)),
    ).toMatchObject({
      key: null,
      props: { initialCount: 12 },
      type: ClientLikeButton,
    });
  });

  it("preserves resolved client-reference component identity across refreshes", async () => {
    const LikeButton = clientReference<{ initialCount: number }>({
      id: "app/LikeButton.client.tsx#LikeButton",
      load: () => Promise.resolve({}),
    });

    function ClientLikeButton() {
      return null;
    }

    const response = createPayloadResponse({
      resolveClientReference() {
        return ClientLikeButton;
      },
    });

    processTestPayloadRows(
      response,
      await renderToPayloadRows(
        createElement(
          PayloadBoundary,
          { id: "slot" },
          createElement(LikeButton, { initialCount: 1 }),
        ),
      ),
    );
    const first = unwrapFunctionComponent(readPayloadRoot(response));

    response.beginRefreshPayload();
    processTestPayloadRows(
      response,
      await renderToPayloadRows(
        createElement(LikeButton, { initialCount: 2 }),
        { refreshBoundary: "slot" },
      ),
    );
    const refreshed = unwrapFunctionComponent(readPayloadRoot(response));

    expect(first).toMatchObject({
      key: null,
      props: { initialCount: 1 },
    });
    expect(refreshed).toMatchObject({
      key: null,
      props: { initialCount: 2 },
    });
    expect(isValidElement(first) && isValidElement(refreshed)).toBe(true);
    if (isValidElement(first) && isValidElement(refreshed)) {
      expect(first.type).toBe(refreshed.type);
    }
  });

  it("rejects functions passed across the server-to-client boundary", async () => {
    const Button = clientReference<{ action: () => void }>({
      id: "app/Button.client.tsx#Button",
      load: () => Promise.resolve({}),
    });

    await expect(
      renderToPayloadRows(createElement(Button, { action: () => undefined })),
    ).resolves.toEqual([
      {
        id: 1,
        tag: "client",
        value: { id: "app/Button.client.tsx#Button", exportName: "Button" },
      },
      {
        id: 0,
        tag: "error",
        value: { message: "Functions cannot be passed to client references." },
      },
    ]);
  });

  it("routes thrown server errors through onError, whose payload is authoritative", async () => {
    const Failing = () => {
      throw new Error("db credentials leaked in message");
    };
    const seen: string[] = [];
    const stacks: string[] = [];

    const rows = await renderToPayloadRows(createElement(Failing, null), {
      onError(error, info) {
        seen.push(error instanceof Error ? error.message : String(error));
        stacks.push(info.componentStack);
        return { digest: "digest-7" };
      },
    });

    expect(rows).toEqual([
      { id: 0, tag: "error", value: { digest: "digest-7" } },
    ]);
    expect(seen).toEqual(["db credentials leaked in message"]);
    expect(stacks).toEqual(["\n    at Failing"]);
  });

  it("sends an empty error payload when onError returns nothing or throws", async () => {
    const Failing = () => {
      throw new Error("secret");
    };

    await expect(
      renderToPayloadRows(createElement(Failing, null), {
        onError: () => undefined,
      }),
    ).resolves.toEqual([{ id: 0, tag: "error", value: {} }]);

    await expect(
      renderToPayloadRows(createElement(Failing, null), {
        onError: () => {
          throw new Error("handler exploded");
        },
      }),
    ).resolves.toEqual([{ id: 0, tag: "error", value: {} }]);
  });

  it("decodes error rows into digest-carrying errors with a generic message", () => {
    const root = decodeTestPayloadRows([
      { id: 0, tag: "error", value: { digest: "digest-9" } },
    ]);

    let thrown: unknown;
    try {
      evaluatePayloadNode(root);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error & { digest?: string }).digest).toBe("digest-9");
    expect((thrown as Error).message).toBe("The server render failed.");
  });

  it("marks refreshable payload boundaries in the model", async () => {
    const rows = await renderToPayloadRows(
      createElement(
        "section",
        null,
        createElement(
          PayloadBoundary,
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

  it("rejects duplicate payload boundary ids", async () => {
    const rows = await renderToPayloadRows(
      createElement(
        "section",
        null,
        createElement(PayloadBoundary, { id: "post" }, "First"),
        createElement(PayloadBoundary, { id: "post" }, "Second"),
      ),
    );

    expect(rows).toContainEqual({
      id: 1,
      tag: "error",
      value: { message: 'Duplicate payload boundary id "post".' },
    });
  });

  it("renders boundary refresh rows", async () => {
    await expect(
      renderToPayloadRows(createElement("p", null, "Updated"), {
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

  it("renders refresh root errors as boundary refresh errors", async () => {
    function Broken(): never {
      throw new Error("refresh failed");
    }

    await expect(
      renderToPayloadRows(createElement(Broken, null), {
        refreshBoundary: "post",
      }),
    ).resolves.toEqual([
      {
        boundary: "post",
        tag: "refresh-error",
        value: { message: "refresh failed" },
      },
    ]);
  });

  it("processes streamed rows incrementally", async () => {
    const response = createPayloadResponse();
    let notifications = 0;
    response.subscribe(() => {
      notifications += 1;
    });

    response.processStringChunk('{"id":0,"tag":"model"');
    expect(notifications).toBe(0);

    response.processStringChunk(',"value":"Ready"}\n');
    expect(notifications).toBe(1);
    expect(evaluatePayloadNode(response.getRoot())).toBe("Ready");
  });

  it("binds refresh rows to a normal Fig root render handle", async () => {
    const response = createPayloadResponse();
    const rendered: FigNode[] = [];
    const unsubscribe = response.bindRoot({
      render(node) {
        rendered.push(node);
      },
    });

    processTestPayloadRows(
      response,
      await renderToPayloadRows(
        createElement(
          "section",
          null,
          createElement(
            PayloadBoundary,
            { id: "post" },
            createElement("p", null, "Initial"),
          ),
        ),
      ),
    );
    processTestPayloadRows(
      response,
      await renderToPayloadRows(createElement("p", null, "Updated"), {
        refreshBoundary: "post",
      }),
    );

    const evaluated = evaluatePayloadNode(rendered[rendered.length - 1]);

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

  it("rejects failed boundary refresh streams without replacing existing content", async () => {
    const response = createPayloadResponse();
    const rendered: FigNode[] = [];
    response.bindRoot({
      render(node) {
        rendered.push(node);
      },
    });

    processTestPayloadRows(
      response,
      await renderToPayloadRows(
        createElement(
          "section",
          null,
          createElement(
            PayloadBoundary,
            { id: "post" },
            createElement("p", null, "Initial"),
          ),
        ),
      ),
    );

    await expect(
      fetchPayload(response, "/payload", {
        fetch: async () =>
          new Response(
            await renderToPayloadText(createElement(BrokenRefresh, null), {
              refreshBoundary: "post",
            }),
            { headers: { "content-type": jsonPayloadCodec.contentType } },
          ),
        refreshBoundary: "post",
      }),
    ).rejects.toThrow("refresh failed");

    expect(evaluatePayloadNode(rendered[rendered.length - 1])).toMatchObject({
      props: {
        children: {
          props: { children: "Initial" },
          type: "p",
        },
      },
      type: "section",
    });

    await fetchPayload(response, "/payload", {
      fetch: async () =>
        new Response(
          await renderToPayloadText(createElement("p", null, "Recovered"), {
            refreshBoundary: "post",
          }),
          { headers: { "content-type": jsonPayloadCodec.contentType } },
        ),
      refreshBoundary: "post",
    });

    expect(evaluatePayloadNode(rendered[rendered.length - 1])).toMatchObject({
      props: {
        children: {
          props: { children: "Recovered" },
          type: "p",
        },
      },
      type: "section",
    });

    function BrokenRefresh(): never {
      throw new Error("refresh failed");
    }
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

    const response = createPayloadResponse({
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
    processTestPayloadRows(
      response,
      await renderToPayloadRows(
        createElement(
          "section",
          null,
          createElement(First, {}),
          createElement(PayloadBoundary, { id: "slot" }, "before"),
        ),
      ),
    );

    // Refresh the boundary with a DIFFERENT client reference. Its outlined row
    // restarts at id 1 on the server and would overwrite chunk 1 (First) in the
    // shared chunks Map without per-payload namespacing.
    response.beginRefreshPayload();
    processTestPayloadRows(
      response,
      await renderToPayloadRows(createElement(Second, {}), {
        refreshBoundary: "slot",
      }),
    );

    // First still resolves to "first" (chunk 1 intact); the boundary shows the
    // refreshed "second".
    expect(evaluatePayloadNode(rendered[rendered.length - 1])).toMatchObject({
      props: { children: ["first", "second"] },
      type: "section",
    });
  });

  it("releases chunks from superseded boundary refresh payloads", async () => {
    const response = createPayloadResponse({
      resolveClientReference: ({ id }) =>
        function Resolved() {
          return id;
        },
    });
    response.bindRoot({ render: () => undefined });

    processTestPayloadRows(
      response,
      await renderToPayloadRows(
        createElement(PayloadBoundary, { id: "slot" }, "before"),
      ),
    );

    for (const id of ["first", "second", "third"]) {
      const Client = clientReference({
        id,
        load: () => Promise.resolve({}),
      });

      response.beginRefreshPayload();
      processTestPayloadRows(
        response,
        await renderToPayloadRows(createElement(Client, {}), {
          refreshBoundary: "slot",
        }),
      );
    }

    const chunks = (response as unknown as { chunks: Map<number, unknown> })
      .chunks;
    expect(chunks.size).toBe(2);
    expect(evaluatePayloadNode(response.getRoot())).toBe("third");
  });

  it("pipes readable streams into a payload response", async () => {
    const response = createPayloadResponse();
    await processStreamInto(
      response,
      streamFromString(
        await renderToPayloadText(createElement("p", null, "Hi")),
      ),
    );

    expect(evaluatePayloadNode(response.getRoot())).toMatchObject({
      props: { children: "Hi" },
      type: "p",
    });
  });

  it("flushes a final payload row without a trailing newline", async () => {
    const response = createPayloadResponse();
    await processStreamInto(
      response,
      streamFromString('{"id":0,"tag":"model","value":"Done"}'),
    );

    expect(evaluatePayloadNode(response.getRoot())).toBe("Done");
  });

  it("fetches initial payload streams with a payload accept header", async () => {
    const response = createPayloadResponse();
    let requestHeaders: Headers | null = null;
    let requestSignal: AbortSignal | null = null;
    const controller = new AbortController();
    const fetchImpl: PayloadFetch = async (_input, init) => {
      requestHeaders = new Headers(init?.headers);
      requestSignal = init?.signal ?? null;
      return new Response(
        await renderToPayloadText(createElement("p", null, "Fetched")),
        {
          headers: { "content-type": jsonPayloadCodec.contentType },
        },
      );
    };

    await fetchPayload(response, "/payload", {
      fetch: fetchImpl,
      signal: controller.signal,
    });

    expect(requireHeaders(requestHeaders).get("accept")).toBe(
      jsonPayloadCodec.contentType,
    );
    expect(requestSignal).toBe(controller.signal);
    expect(evaluatePayloadNode(response.getRoot())).toMatchObject({
      props: { children: "Fetched" },
      type: "p",
    });
  });

  it("cancels initial payload fetches before mutating the response", async () => {
    const response = createPayloadResponse();
    const controller = new AbortController();
    let fetches = 0;
    let notifications = 0;
    response.subscribe(() => {
      notifications += 1;
    });

    controller.abort();

    let error: unknown;
    try {
      await fetchPayload(response, "/payload", {
        fetch: async () => {
          fetches += 1;
          return new Response("unreachable");
        },
        signal: controller.signal,
      });
    } catch (caught) {
      error = caught;
    }

    expect(isPayloadRequestCancelled(error)).toBe(true);
    expect(fetches).toBe(0);
    expect(notifications).toBe(0);
  });

  it("cancels partial payload streams without flushing buffered rows", async () => {
    const response = createPayloadResponse();
    const stream = controlledTextStream();
    const controller = new AbortController();
    let notifications = 0;
    response.subscribe(() => {
      notifications += 1;
    });

    const request = fetchPayload(response, "/payload", {
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

    expect(isPayloadRequestCancelled(error)).toBe(true);
    expect(notifications).toBe(0);
  });

  it("cancelling a payload stream leaves no unhandled rejection", async () => {
    const pending = deferred<string>();

    function Slow() {
      return createElement("p", null, readPromise(pending.promise));
    }

    const result = renderToPayloadStream(
      createElement("section", null, createElement(Slow, null)),
    );

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      // Client disconnect: the consumer cancels without awaiting allReady.
      await result.stream.cancel(new Error("client disconnected"));
      // unhandledRejection fires after the microtask queue drains; give it
      // two macrotasks to surface before attaching our own handler.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }

    expect(unhandled).toEqual([]);
    // Awaiting callers still observe the rejection.
    await expect(result.allReady).rejects.toThrow("client disconnected");
  });

  it("fetches boundary refresh streams with the boundary header", async () => {
    const response = createPayloadResponse();
    let requestHeaders: Headers | null = null;
    const fetchImpl: PayloadFetch = async (_input, init) => {
      requestHeaders = new Headers(init?.headers);
      return new Response(
        await renderToPayloadText(createElement("p", null, "Fetched refresh"), {
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

    processTestPayloadRows(
      response,
      await renderToPayloadRows(
        createElement(
          "section",
          null,
          createElement(
            PayloadBoundary,
            { id: "post" },
            createElement("p", null, "Initial"),
          ),
        ),
      ),
    );
    await fetchPayload(response, "/payload/post", {
      fetch: fetchImpl,
      headers: { accept: "custom/payload" },
      refreshBoundary: "post",
    });

    const headers = requireHeaders(requestHeaders);
    expect(headers.get("accept")).toBe("custom/payload");
    expect(headers.get("x-fig-payload-boundary")).toBe("post");
    expect(evaluatePayloadNode(rendered[rendered.length - 1])).toMatchObject({
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
    const response = createPayloadResponse();
    const stream = controlledTextStream();
    const controller = new AbortController();
    const rendered: FigNode[] = [];
    response.bindRoot({
      render(node) {
        rendered.push(node);
      },
    });

    processTestPayloadRows(
      response,
      await renderToPayloadRows(
        createElement(
          "section",
          null,
          createElement(
            PayloadBoundary,
            { id: "post" },
            createElement("p", null, "Initial"),
          ),
        ),
      ),
    );

    const request = fetchPayload(response, "/payload/post", {
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

    expect(isPayloadRequestCancelled(error)).toBe(true);
    expect(evaluatePayloadNode(rendered[rendered.length - 1])).toMatchObject({
      props: {
        children: {
          props: { children: "Initial" },
          type: "p",
        },
      },
      type: "section",
    });
  });

  it("rejects failed payload fetches before mutating the response", async () => {
    const response = createPayloadResponse();
    let notifications = 0;
    response.subscribe(() => {
      notifications += 1;
    });

    await expect(
      fetchPayload(response, "/payload", {
        fetch: async () => new Response("nope", { status: 500 }),
      }),
    ).rejects.toThrow("Payload request failed with status 500.");
    expect(notifications).toBe(0);
  });

  it("rejects malformed payload streams as real failures", async () => {
    const response = createPayloadResponse();

    await expect(
      fetchPayload(response, "/payload", {
        fetch: async () => new Response(streamFromString("{not-json}\n")),
      }),
    ).rejects.toThrow(SyntaxError);
  });
});
