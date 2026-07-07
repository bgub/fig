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
  decodePayloadDataEntries,
  decodePayloadValue,
  encodePayloadDataEntries,
  encodePayloadValue,
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
  | TestPayloadElementModel
  | TestPayloadModel[]
  | { [key: string]: unknown };

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
  id?: number;
  key: string | number | null;
  props: TestPayloadModel;
  type: TestPayloadModel;
}

function graphElement(
  _id: number,
  type: TestPayloadModel,
  props: Record<string, TestPayloadModel>,
): TestPayloadElementModel {
  return {
    $fig: "element",
    key: null,
    props: { $fig: "object", value: props },
    type,
  };
}

function graphElementWithId(
  id: number,
  type: TestPayloadModel,
  props: Record<string, TestPayloadModel>,
): TestPayloadElementModel {
  return {
    ...graphElement(id, type, props),
    id,
  };
}

function graphProps(model: TestPayloadElementModel): Record<string, unknown> {
  const props = model.props as {
    $fig?: string;
    value?: Record<string, unknown>;
  };
  if (props.$fig !== "object" || props.value === undefined) {
    throw new Error("Expected graph object props.");
  }
  return props.value;
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
        value: graphElement(
          1,
          { $fig: "client", id: 1 },
          {
            initialCount: 12,
            tone: "primary",
          },
        ),
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

    const props = graphProps(root.value);
    expect(props.header).toEqual(
      graphElement(3, "h2", { children: "Server header" }),
    );
    expect(props.children).toEqual(
      graphElementWithId(1, "p", { children: "Server child" }),
    );
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
        value: graphElement(1, "div", {
          children: ["Before ", { $fig: "lazy", id: 1 }],
        }),
      },
      {
        id: 1,
        tag: "model",
        value: graphElement(4, "span", { children: "Ready" }),
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
        value: graphElement(1, "div", { children: { $fig: "lazy", id: 1 } }),
      },
      {
        id: 1,
        tag: "model",
        value: graphElement(3, "span", { children: "Lazy ready" }),
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
        value: graphElement(
          1,
          { $fig: "client", id: 1 },
          {
            value: { $fig: "promise", id: 2 },
          },
        ),
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

  it("round-trips cyclic and shared payload values", () => {
    const shared = { label: "shared" };
    const value: Record<string, unknown> = {
      alias: shared,
      shared,
    };
    const list: unknown[] = [value, shared];
    const map = new Map<unknown, unknown>([
      ["root", value],
      [value, shared],
    ]);
    const set = new Set<unknown>([value, shared]);
    value.self = value;
    value.list = list;
    value.map = map;
    value.set = set;
    list.push(list);

    const decoded = decodePayloadValue(encodePayloadValue(value)) as Record<
      string,
      unknown
    >;
    const decodedShared = decoded.shared;

    expect(decoded.self).toBe(decoded);
    expect(decoded.alias).toBe(decodedShared);
    expect((decoded.list as unknown[])[0]).toBe(decoded);
    expect((decoded.list as unknown[])[1]).toBe(decodedShared);
    expect((decoded.list as unknown[])[2]).toBe(decoded.list);
    expect((decoded.map as Map<unknown, unknown>).get("root")).toBe(decoded);
    expect((decoded.map as Map<unknown, unknown>).get(decoded)).toBe(
      decodedShared,
    );
    expect((decoded.set as Set<unknown>).has(decoded)).toBe(true);
    expect((decoded.set as Set<unknown>).has(decodedShared)).toBe(true);
  });

  it("round-trips shared objects across payload data entries", () => {
    const shared = { label: "shared-data" };
    const encoded = encodePayloadDataEntries([
      { key: ["first"], value: shared },
      { key: ["second"], value: shared },
    ]);

    const decoded = decodePayloadDataEntries(encoded);

    expect(decoded[0]?.value).toBe(decoded[1]?.value);
  });

  it("preserves shared object identity across async payload rows", async () => {
    const Viewer = clientReference<{
      later: Promise<unknown>;
      value: unknown;
    }>({
      id: "app/Viewer.client.tsx#Viewer",
      load: () => Promise.resolve({}),
    });
    const shared = { label: "shared" };
    const pending = deferred<typeof shared>();

    const result = renderToPayloadStream(
      createElement(Viewer, { later: pending.promise, value: shared }),
    );
    pending.resolve(shared);
    await result.allReady;
    const rows = parseTestPayloadRows(await readStream(result.stream));

    const response = createPayloadResponse({
      resolveClientReference: () => "fig-viewer",
    });
    processTestPayloadRows(response, rows);

    const decoded = readPayloadRoot(response);
    if (!isValidElement(decoded)) throw new Error("Expected decoded element.");

    await expect(decoded.props.later).resolves.toBe(decoded.props.value);
  });

  it("resolves lazy refs to objects first defined inside boundary children", async () => {
    const Viewer = clientReference<{ value: unknown }>({
      id: "app/Viewer.client.tsx#Viewer",
      load: () => Promise.resolve({}),
    });
    const shared = { label: "shared" };
    const pending = deferred<typeof shared>();

    function SuspendedViewer() {
      return createElement(Viewer, { value: readPromise(pending.promise) });
    }

    const result = renderToPayloadStream(
      createElement(
        "div",
        null,
        createElement(
          PayloadBoundary,
          { id: "slot" },
          createElement(Viewer, { value: shared }),
        ),
        createElement(SuspendedViewer, null),
      ),
    );
    pending.resolve(shared);
    await result.allReady;

    const response = createPayloadResponse({
      resolveClientReference: () => "fig-viewer",
    });
    processTestPayloadRows(
      response,
      parseTestPayloadRows(await readStream(result.stream)),
    );

    const root = readPayloadRoot(response);
    if (!isValidElement(root) || !Array.isArray(root.props.children)) {
      throw new Error("Expected decoded root children.");
    }
    const boundaryChild = unwrapFunctionComponent(root.props.children[0]);
    const lazyChild = unwrapFunctionComponent(root.props.children[1]);
    if (!isValidElement(boundaryChild) || !isValidElement(lazyChild)) {
      throw new Error("Expected decoded client elements.");
    }

    expect(lazyChild.props.value).toBe(boundaryChild.props.value);
  });

  it("resolves refresh lazy refs to objects first defined in refresh content", async () => {
    const Viewer = clientReference<{ value: unknown }>({
      id: "app/Viewer.client.tsx#Viewer",
      load: () => Promise.resolve({}),
    });
    const shared = { label: "refresh-shared" };
    const pending = deferred<typeof shared>();

    function SuspendedViewer() {
      return createElement(Viewer, { value: readPromise(pending.promise) });
    }

    const response = createPayloadResponse({
      resolveClientReference: () => "fig-viewer",
    });
    processTestPayloadRows(
      response,
      await renderToPayloadRows(
        createElement(PayloadBoundary, { id: "slot" }, "initial"),
      ),
    );

    const result = renderToPayloadStream(
      createElement(
        "div",
        null,
        createElement(Viewer, { value: shared }),
        createElement(SuspendedViewer, null),
      ),
      { refreshBoundary: "slot" },
    );
    pending.resolve(shared);
    await result.allReady;

    response.beginRefreshPayload();
    processTestPayloadRows(
      response,
      parseTestPayloadRows(await readStream(result.stream)),
    );

    const refreshed = unwrapFunctionComponent(readPayloadRoot(response));
    if (
      !isValidElement(refreshed) ||
      !Array.isArray(refreshed.props.children)
    ) {
      throw new Error("Expected refreshed children.");
    }
    const first = refreshed.props.children[0];
    const second = unwrapFunctionComponent(refreshed.props.children[1]);
    if (!isValidElement(first) || !isValidElement(second)) {
      throw new Error("Expected decoded refresh client elements.");
    }

    expect(second.props.value).toBe(first.props.value);
  });

  it("keeps async shared identity stable after unrelated refreshes", async () => {
    const Viewer = clientReference<{
      later: Promise<unknown>;
      value: unknown;
    }>({
      id: "app/Viewer.client.tsx#Viewer",
      load: () => Promise.resolve({}),
    });
    const shared = { label: "stable" };
    const pending = deferred<typeof shared>();

    const result = renderToPayloadStream(
      createElement(
        "main",
        null,
        createElement(Viewer, { later: pending.promise, value: shared }),
        createElement(PayloadBoundary, { id: "slot" }, "initial"),
      ),
    );
    pending.resolve(shared);
    await result.allReady;

    const response = createPayloadResponse({
      resolveClientReference: () => "fig-viewer",
    });
    processTestPayloadRows(
      response,
      parseTestPayloadRows(await readStream(result.stream)),
    );

    response.beginRefreshPayload();
    processTestPayloadRows(
      response,
      await renderToPayloadRows("refreshed", { refreshBoundary: "slot" }),
    );

    const root = readPayloadRoot(response);
    if (!isValidElement(root) || !Array.isArray(root.props.children)) {
      throw new Error("Expected decoded root children.");
    }
    const viewer = root.props.children[0];
    if (!isValidElement(viewer)) throw new Error("Expected viewer element.");

    await expect(viewer.props.later).resolves.toBe(viewer.props.value);
  });

  it("keeps object refs from transitive lazy chunks after unrelated refreshes", () => {
    const response = createPayloadResponse();
    processTestPayloadRows(response, [
      {
        id: 0,
        tag: "model",
        value: graphElement(1, "main", {
          children: [
            { $fig: "lazy", id: 1 },
            { $fig: "boundary", child: "initial", id: "slot" },
          ],
        }),
      },
      {
        id: 1,
        tag: "model",
        value: graphElement(2, "section", {
          children: [
            { $fig: "lazy", id: 3 },
            { $fig: "lazy", id: 2 },
          ],
        }),
      },
      {
        id: 2,
        tag: "model",
        value: graphElement(3, "span", {
          value: { $fig: "object", id: 1, value: { label: "shared" } },
        }),
      },
      {
        id: 3,
        tag: "model",
        value: graphElement(4, "span", {
          value: { $fig: "ref", id: 1 },
        }),
      },
    ]);

    const initial = evaluatePayloadNode(response.getRoot());
    expect(initial).toMatchObject({
      props: {
        children: [
          {
            props: {
              children: [
                { props: { value: { label: "shared" } }, type: "span" },
                { props: { value: { label: "shared" } }, type: "span" },
              ],
            },
            type: "section",
          },
          "initial",
        ],
      },
      type: "main",
    });

    response.beginRefreshPayload();
    processTestPayloadRows(response, [
      { boundary: "slot", tag: "refresh", value: "refreshed" },
    ]);

    const refreshed = evaluatePayloadNode(response.getRoot());
    expect(refreshed).toMatchObject({
      props: {
        children: [
          {
            props: {
              children: [
                { props: { value: { label: "shared" } }, type: "span" },
                { props: { value: { label: "shared" } }, type: "span" },
              ],
            },
            type: "section",
          },
          "refreshed",
        ],
      },
      type: "main",
    });
    if (
      !isValidElement(refreshed) ||
      !Array.isArray(refreshed.props.children)
    ) {
      throw new Error("Expected refreshed lazy subtree.");
    }
    const section = refreshed.props.children[0];
    if (!isValidElement(section) || !Array.isArray(section.props.children)) {
      throw new Error("Expected refreshed nested lazy children.");
    }
    const refFirst = section.props.children[0];
    const defSecond = section.props.children[1];
    if (!isValidElement(refFirst) || !isValidElement(defSecond)) {
      throw new Error("Expected refreshed lazy host elements.");
    }
    expect(refFirst.props.value).toBe(defSecond.props.value);
  });

  it("refreshes boundaries discovered inside retained lazy chunks", () => {
    const response = createPayloadResponse();
    processTestPayloadRows(response, [
      {
        id: 0,
        tag: "model",
        value: graphElement(1, "main", {
          children: { $fig: "lazy", id: 1 },
        }),
      },
      {
        id: 1,
        tag: "model",
        value: {
          $fig: "boundary",
          child: "initial",
          id: "slot",
        },
      },
    ]);

    expect(evaluatePayloadNode(response.getRoot())).toMatchObject({
      props: { children: "initial" },
      type: "main",
    });

    response.beginRefreshPayload();
    processTestPayloadRows(response, [
      { boundary: "slot", tag: "refresh", value: "refreshed" },
    ]);

    expect(evaluatePayloadNode(response.getRoot())).toMatchObject({
      props: { children: "refreshed" },
      type: "main",
    });
  });

  it("preserves cyclic objects in rendered client props", async () => {
    const Viewer = clientReference<{ value: unknown }>({
      id: "app/Viewer.client.tsx#Viewer",
      load: () => Promise.resolve({}),
    });
    const value: Record<string, unknown> = { label: "cycle" };
    value.self = value;

    const response = createPayloadResponse({
      resolveClientReference: () => "fig-viewer",
    });
    processTestPayloadRows(
      response,
      await renderToPayloadRows(createElement(Viewer, { value })),
    );

    const decoded = readPayloadRoot(response);
    if (!isValidElement(decoded)) throw new Error("Expected decoded element.");

    expect(decoded.props.value.self).toBe(decoded.props.value);
  });

  it("rolls back graph refs from client elements discarded into lazy errors", async () => {
    const Viewer = clientReference<{
      bad?: () => void;
      shared: unknown;
    }>({
      id: "app/Viewer.client.tsx#Viewer",
      load: () => Promise.resolve({}),
    });
    const shared = { label: "shared" };
    const rows = await renderToPayloadRows([
      createElement(Viewer, {
        bad: () => undefined,
        shared,
      }),
      createElement(Viewer, { shared }),
    ]);
    const response = createPayloadResponse({
      resolveClientReference: () => "fig-viewer",
    });

    expect(() => processTestPayloadRows(response, rows)).not.toThrow();

    const decoded = readPayloadRoot(response);
    if (!Array.isArray(decoded) || !isValidElement(decoded[1])) {
      throw new Error("Expected decoded sibling client element.");
    }

    expect(decoded[1].props.shared).toEqual({ label: "shared" });
  });

  it("serializes client children and fallback props as values", async () => {
    const Viewer = clientReference<{
      children?: unknown;
      fallback?: unknown;
      mirror?: unknown;
    }>({
      id: "app/Viewer.client.tsx#Viewer",
      load: () => Promise.resolve({}),
    });
    const child = createElement("span", null, "shared child");
    const fallback = new Map<unknown, unknown>([["state", "ready"]]);

    const response = createPayloadResponse({
      resolveClientReference: () => "fig-viewer",
    });
    processTestPayloadRows(
      response,
      await renderToPayloadRows(
        createElement(Viewer, {
          children: child,
          fallback,
          mirror: child,
        }),
      ),
    );

    const decoded = unwrapFunctionComponent(readPayloadRoot(response));
    if (!isValidElement(decoded)) throw new Error("Expected decoded element.");

    expect(decoded.props.children).toBe(decoded.props.mirror);
    expect(decoded.props.children).toMatchObject({
      props: { children: "shared child" },
      type: "span",
    });
    expect(decoded.props.fallback).toBeInstanceOf(Map);
    expect(decoded.props.fallback.get("state")).toBe("ready");
  });

  it("serializes object children on client references as values", async () => {
    const Viewer = clientReference<{ children?: unknown }>({
      id: "app/Viewer.client.tsx#Viewer",
      load: () => Promise.resolve({}),
    });

    const response = createPayloadResponse({
      resolveClientReference: () => "fig-viewer",
    });
    processTestPayloadRows(
      response,
      await renderToPayloadRows(
        createElement(Viewer, { children: { custom: "data" } }),
      ),
    );

    const decoded = unwrapFunctionComponent(readPayloadRoot(response));
    if (!isValidElement(decoded)) throw new Error("Expected decoded element.");

    expect(decoded.props.children).toEqual({ custom: "data" });
  });

  it("keeps refresh payload object refs isolated from previous payloads", async () => {
    const Viewer = clientReference<{ value: unknown }>({
      id: "app/Viewer.client.tsx#Viewer",
      load: () => Promise.resolve({}),
    });
    const response = createPayloadResponse({
      resolveClientReference: () => "fig-viewer",
    });

    const first: Record<string, unknown> = { label: "first" };
    first.self = first;
    processTestPayloadRows(
      response,
      await renderToPayloadRows(
        createElement(
          PayloadBoundary,
          { id: "slot" },
          createElement(Viewer, { value: first }),
        ),
      ),
    );

    const second: Record<string, unknown> = { label: "second" };
    second.self = second;
    response.beginRefreshPayload();
    processTestPayloadRows(
      response,
      await renderToPayloadRows(createElement(Viewer, { value: second }), {
        refreshBoundary: "slot",
      }),
    );

    const decoded = unwrapFunctionComponent(readPayloadRoot(response));
    if (!isValidElement(decoded)) throw new Error("Expected decoded element.");

    expect(decoded.props.value.label).toBe("second");
    expect(decoded.props.value.self).toBe(decoded.props.value);
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
      value: graphElement(
        1,
        { $fig: "suspense" },
        {
          children: { $fig: "lazy", id: 1 },
          fallback: graphElement(3, "em", { children: "Loading" }),
        },
      ),
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
        value: graphElement(1, "section", {
          children: {
            $fig: "boundary",
            child: graphElement(3, "p", { children: "Initial" }),
            id: "post",
          },
        }),
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
        value: graphElement(1, "p", { children: "Updated" }),
      },
    ]);
  });

  it("rejects refresh payloads that include the target boundary wrapper", async () => {
    await expect(
      renderToPayloadRows(
        createElement(PayloadBoundary, { id: "post" }, "Updated"),
        {
          refreshBoundary: "post",
        },
      ),
    ).resolves.toEqual([
      {
        boundary: "post",
        tag: "refresh-error",
        value: {
          message:
            'Refresh payload for boundary "post" must render that boundary\'s replacement content, not a nested PayloadBoundary with the same id.',
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
    response.beginRefreshPayload();
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

  it("uses the latest initial model for boundaries nested inside refreshed content", async () => {
    const response = createPayloadResponse();
    processTestPayloadRows(
      response,
      await renderToPayloadRows(
        createElement(
          PayloadBoundary,
          { id: "outer" },
          createElement(PayloadBoundary, { id: "inner" }, "old inner"),
        ),
      ),
    );

    response.beginRefreshPayload();
    processTestPayloadRows(
      response,
      await renderToPayloadRows(
        createElement(PayloadBoundary, { id: "inner" }, "new inner"),
        { refreshBoundary: "outer" },
      ),
    );

    expect(evaluatePayloadNode(response.getRoot())).toBe("new inner");
  });

  it("lets a newer parent refresh supersede an older targeted child refresh", async () => {
    const response = createPayloadResponse();
    processTestPayloadRows(
      response,
      await renderToPayloadRows(
        createElement(
          PayloadBoundary,
          { id: "outer" },
          createElement(PayloadBoundary, { id: "inner" }, "old inner"),
        ),
      ),
    );

    response.beginRefreshPayload();
    processTestPayloadRows(
      response,
      await renderToPayloadRows("targeted inner", {
        refreshBoundary: "inner",
      }),
    );
    expect(evaluatePayloadNode(response.getRoot())).toBe("targeted inner");

    response.beginRefreshPayload();
    processTestPayloadRows(
      response,
      await renderToPayloadRows(
        createElement(PayloadBoundary, { id: "inner" }, "new parent inner"),
        { refreshBoundary: "outer" },
      ),
    );

    expect(evaluatePayloadNode(response.getRoot())).toBe("new parent inner");
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

  it("does not rebase late rows from an overlapping initial stream", async () => {
    const response = createPayloadResponse();
    const initial = controlledTextStream();
    const initialDone = processStreamInto(response, initial.stream);

    initial.write('{"id":5,"tag":"model","value":"unreferenced"}\n');
    initial.write('{"id":0,"tag":"model","value":{"$fig":"lazy","id":1}}\n');
    await response.rootReady;
    try {
      evaluatePayloadNode(response.getRoot());
    } catch {
      // The lazy root is intentionally pending while a refresh starts.
    }

    response.beginRefreshPayload();
    processTestPayloadRows(response, [
      { boundary: "slot", tag: "refresh", value: "ignored" },
    ]);

    initial.write('{"id":1,"tag":"model","value":"late"}\n');
    initial.close();
    await initialDone;

    const chunks = (
      response as unknown as {
        chunks: Map<number, { status: string; value: unknown }>;
      }
    ).chunks;
    expect(chunks.get(1)?.status).toBe("fulfilled");
    expect(chunks.get(1)?.value).toBe("late");
    expect(chunks.has(6)).toBe(false);
    expect(evaluatePayloadNode(response.getRoot())).toBe("late");
  });

  it("retains transitive chunks referenced from live lazy chunks", () => {
    const response = createPayloadResponse();
    processTestPayloadRows(response, [
      {
        id: 0,
        tag: "model",
        value: {
          $fig: "boundary",
          child: { $fig: "lazy", id: 1 },
          id: "slot",
        },
      },
      {
        id: 1,
        tag: "model",
        value: graphElement(1, "section", {
          children: { $fig: "lazy", id: 2 },
        }),
      },
      {
        id: 2,
        tag: "model",
        value: graphElement(2, "span", { children: "Nested" }),
      },
    ]);

    const chunks = (response as unknown as { chunks: Map<number, unknown> })
      .chunks;
    expect(chunks.has(1)).toBe(true);
    expect(chunks.has(2)).toBe(true);
    expect(evaluatePayloadNode(response.getRoot())).toMatchObject({
      props: {
        children: {
          props: { children: "Nested" },
          type: "span",
        },
      },
      type: "section",
    });
  });

  it("retains chunks while a pending lazy chunk may still reference them", async () => {
    const response = createPayloadResponse();
    processTestPayloadRows(response, [
      {
        id: 0,
        tag: "model",
        value: graphElement(1, "main", {
          children: [
            { $fig: "lazy", id: 1 },
            { $fig: "boundary", child: "initial", id: "slot" },
          ],
        }),
      },
    ]);

    try {
      evaluatePayloadNode(response.getRoot());
    } catch {
      // The lazy child is intentionally still pending.
    }

    processTestPayloadRows(response, [
      {
        id: 5,
        tag: "model",
        value: graphElement(5, "span", { children: "Retained" }),
      },
    ]);

    const initial = controlledTextStream();
    const initialDone = processStreamInto(response, initial.stream);

    response.beginRefreshPayload();
    processTestPayloadRows(response, [
      { boundary: "slot", tag: "refresh", value: "refreshed" },
    ]);

    const chunks = (response as unknown as { chunks: Map<number, unknown> })
      .chunks;
    expect(chunks.has(5)).toBe(true);

    initial.write('{"id":1,"tag":"model","value":{"$fig":"lazy","id":5}}\n');
    initial.close();
    await initialDone;

    expect(evaluatePayloadNode(response.getRoot())).toMatchObject({
      props: {
        children: [
          { props: { children: "Retained" }, type: "span" },
          "refreshed",
        ],
      },
      type: "main",
    });
  });

  it("releases transitive chunks from superseded boundary refresh payloads", () => {
    const response = createPayloadResponse();
    processTestPayloadRows(response, [
      {
        id: 0,
        tag: "model",
        value: {
          $fig: "boundary",
          child: { $fig: "lazy", id: 1 },
          id: "slot",
        },
      },
      {
        id: 1,
        tag: "model",
        value: graphElement(1, "section", {
          children: { $fig: "lazy", id: 2 },
        }),
      },
      {
        id: 2,
        tag: "model",
        value: graphElement(2, "span", {
          value: { $fig: "object", id: 1, value: { label: "old" } },
        }),
      },
    ]);

    response.beginRefreshPayload();
    processTestPayloadRows(response, [
      { boundary: "slot", tag: "refresh", value: "refreshed" },
    ]);

    const state = response as unknown as {
      chunks: Map<number, unknown>;
      objectRefs: Map<number, unknown>;
    };
    expect(state.chunks.has(1)).toBe(false);
    expect(state.chunks.has(2)).toBe(false);
    expect(state.objectRefs.has(1)).toBe(false);
    expect(evaluatePayloadNode(response.getRoot())).toBe("refreshed");
  });

  it("releases chunks from refreshed boundaries dropped by parent refreshes", () => {
    const response = createPayloadResponse();
    processTestPayloadRows(response, [
      {
        id: 0,
        tag: "model",
        value: {
          $fig: "boundary",
          child: {
            $fig: "boundary",
            child: "initial inner",
            id: "inner",
          },
          id: "outer",
        },
      },
    ]);

    response.beginRefreshPayload();
    processTestPayloadRows(response, [
      { boundary: "inner", tag: "refresh", value: { $fig: "lazy", id: 1 } },
      {
        id: 1,
        tag: "model",
        value: graphElement(1, "span", {
          value: { $fig: "object", id: 1, value: { label: "inner" } },
        }),
      },
    ]);
    expect(evaluatePayloadNode(response.getRoot())).toMatchObject({
      props: { value: { label: "inner" } },
      type: "span",
    });

    response.beginRefreshPayload();
    processTestPayloadRows(response, [
      { boundary: "outer", tag: "refresh", value: "outer only" },
    ]);

    const state = response as unknown as {
      boundaries: Map<string, unknown>;
      chunks: Map<number, unknown>;
      decodedBoundaries: Map<string, unknown>;
      initialBoundaries: Map<string, unknown>;
      objectRefs: Map<number, unknown>;
    };
    expect(state.chunks.has(1)).toBe(false);
    expect(state.objectRefs.has(1)).toBe(false);
    expect(state.boundaries.has("inner")).toBe(false);
    expect(state.initialBoundaries.has("inner")).toBe(false);
    expect(state.decodedBoundaries.has("inner")).toBe(false);
    expect(evaluatePayloadNode(response.getRoot())).toBe("outer only");
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

    await fetchPayload(response, "/payload/post", {
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
