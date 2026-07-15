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
  isValidElement,
  lazy,
  modulepreload,
  preload,
  readContext,
  readPromise,
  Suspense,
  stylesheet,
  title,
  ViewTransition,
} from "@bgub/fig";
import {
  decodePayloadDataEntries,
  decodePayloadValue,
  encodePayloadDataEntries,
  encodePayloadValue,
  jsonPayloadCodec,
  type PayloadRow,
  readThenable,
  setCurrentDispatcher,
} from "@bgub/fig/internal";
import {
  decodePayloadStream,
  type PayloadClientReference,
  type PayloadDecodeCompletion,
  type PayloadDecodeOptions,
} from "@bgub/fig/payload";
import { describe, expect, it } from "vitest";
import * as payloadApi from "./payload.ts";
import { renderToPayloadStream } from "./payload.ts";
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
  | { for?: number; tag: "assets"; value: TestPayloadModel[] }
  | {
      id: number;
      tag: "client";
      value: { id: string; assets?: TestPayloadModel[]; exportName?: string };
    }
  | { id: number; tag: "error"; value: { digest?: string; message?: string } }
  | { id: number; tag: "model"; value: TestPayloadModel };

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

// Hand-authored (or pre-rendered) rows go back through the real codec and a
// real byte stream so tests exercise decodePayloadStream end to end.
function decodeTestPayloadRows(
  rows: readonly TestPayloadRow[],
  options?: PayloadDecodeOptions,
): { decode: Promise<FigNode>; done: Promise<PayloadDecodeCompletion> } {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const row of rows) {
        controller.enqueue(
          jsonPayloadCodec.encodeRow(row as unknown as PayloadRow),
        );
      }
      controller.close();
    },
  });
  const { done, onStreamDone } = streamDone();
  return {
    decode: decodePayloadStream(stream, { ...options, onStreamDone }),
    done,
  };
}

// Captures onStreamDone so tests can await the end of ingestion.
function streamDone(): {
  done: Promise<PayloadDecodeCompletion>;
  onStreamDone: (result: PayloadDecodeCompletion) => void;
} {
  const result = deferred<PayloadDecodeCompletion>();
  return { done: result.promise, onStreamDone: result.resolve };
}

function withTestDispatcher<T>(run: () => T): T {
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
  const previous = setCurrentDispatcher(dispatcher);
  try {
    return run();
  } finally {
    setCurrentDispatcher(previous);
  }
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

// Decoded client/lazy components read tracked thenables, so evaluate them
// under a minimal dispatcher, as a real renderer would.
function renderNode(node: FigNode): FigNode {
  return withTestDispatcher(() => evaluatePayloadNode(node));
}

function unwrapFunctionComponent(node: FigNode): FigNode {
  if (!isValidElement(node) || typeof node.type !== "function") return node;

  return (node.type as ElementType & ((props: FigElement["props"]) => FigNode))(
    node.props,
  );
}

describe("payload rendering", () => {
  it("keeps the public runtime surface to the renderer", () => {
    expect(Object.keys(payloadApi)).toEqual(["renderToPayloadStream"]);
  });

  it("serializes client references with normal JSX props", async () => {
    const LikeButton = clientReference<{
      initialCount: number;
      tone?: string;
    }>({
      id: "app/LikeButton.client.tsx#LikeButton",
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
    });

    const rows = await renderToPayloadRows(createElement(Plain, {}));

    expect(rows.find((row) => row.tag === "client")).toEqual({
      id: 1,
      tag: "client",
      value: { id: "app/Plain.client.tsx#Plain", exportName: "Plain" },
    });
  });

  it("passes reference metadata and assets to client reference resolvers", async () => {
    const Counter = clientReference({
      id: "app/Counter.client.tsx#Counter",
      assets: [stylesheet("/assets/Counter.css")],
    });

    const rows = await renderToPayloadRows(createElement(Counter, {}));
    const seen: PayloadClientReference[] = [];
    const { done } = decodeTestPayloadRows(rows, {
      resolveClientReference(metadata) {
        seen.push(metadata);
        return () => null;
      },
    });
    expect(await done).toEqual({ status: "complete" });

    expect(seen).toEqual([
      {
        assets: [{ href: "/assets/Counter.css", kind: "stylesheet" }],
        exportName: "Counter",
        id: "app/Counter.client.tsx#Counter",
      },
    ]);
  });

  it("reports missing client reference loaders when decoded references render", async () => {
    const Widget = clientReference({
      id: "app/Widget.client.tsx#Widget",
    });
    const rows = await renderToPayloadRows(createElement(Widget, {}));
    const { decode } = decodeTestPayloadRows(rows);
    const root = await decode;

    expect(() => renderNode(root)).toThrow(
      'Cannot render client reference "app/Widget.client.tsx#Widget" because decodePayloadStream was not configured with a matching resolveClientReference.',
    );
  });

  it("starts client reference loads at row arrival and renders synchronously once settled", async () => {
    const Widget = clientReference({
      id: "app/Widget.client.tsx#Widget",
    });
    const rows = await renderToPayloadRows(
      createElement(Widget, { label: "hi" }),
    );

    const ResolvedWidget = (props: { label: string }) =>
      createElement("span", null, `widget:${props.label}`);
    const resolution = deferred<typeof ResolvedWidget>();
    let loads = 0;

    const { decode, done } = decodeTestPayloadRows(rows, {
      resolveClientReference: () => {
        loads += 1;
        return resolution.promise;
      },
    });
    const root = await decode;
    expect(await done).toEqual({ status: "complete" });

    // The load started when the client row arrived, before any render.
    expect(loads).toBe(1);

    // Before the resolution settles, the first render read suspends.
    let thrown: unknown;
    try {
      void renderNode(root);
    } catch (error) {
      thrown = error;
    }
    expect(typeof (thrown as PromiseLike<unknown>).then).toBe("function");

    // Once the tracked resolution settles, rendering is synchronous and the row
    // load was never repeated.
    resolution.resolve(ResolvedWidget);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const rendered = renderNode(root) as FigElement;
    expect(isValidElement(rendered)).toBe(true);
    expect(rendered.type).toBe("span");
    expect(rendered.props.children).toBe("widget:hi");
    expect(loads).toBe(1);
  });

  it("ignores invalid asset descriptors while decoding client rows", async () => {
    const prepared: unknown[] = [];
    const { done } = decodeTestPayloadRows(
      [
        {
          id: 1,
          tag: "client",
          value: {
            id: "app/Counter.client.tsx#Counter",
            assets: [
              { href: "/assets/Counter.css", kind: "stylesheet" },
              { href: "/assets/Unknown.asset", kind: "unknown" },
            ],
          },
        },
        { id: 0, tag: "model", value: null },
      ],
      {
        prepareAssets(list) {
          prepared.push(...list);
        },
      },
    );
    expect(await done).toEqual({ status: "complete" });

    expect(prepared).toEqual([
      { href: "/assets/Counter.css", kind: "stylesheet" },
    ]);
  });

  it("sends explicit assets from payload subtrees", async () => {
    const rows = parseTestPayloadRows(
      await renderToPayloadText(
        assets(
          [
            stylesheet("/assets/ServerRoute.css"),
            preload("/mark.svg", "image"),
          ],
          createElement("article", null, "Server route"),
        ),
      ),
    );

    const assetsRow = rows.find((row) => row.tag === "assets");
    if (assetsRow === undefined || assetsRow.tag !== "assets") {
      throw new Error("Expected an assets row.");
    }
    expect(assetsRow.value).toEqual([
      { href: "/assets/ServerRoute.css", kind: "stylesheet" },
      { as: "image", href: "/mark.svg", kind: "preload" },
    ]);

    // The assets row gates the reveal of the model row it names, and it must
    // already be on the wire when that row arrives.
    const gatedIndex = rows.findIndex(
      (row) => row.tag === "model" && row.id === assetsRow.for,
    );
    expect(gatedIndex).toBeGreaterThanOrEqual(0);
    expect(rows.indexOf(assetsRow)).toBeLessThan(gatedIndex);
  });

  it("sends and dedupes assets only for client references that render", async () => {
    const shared = stylesheet("/assets/shared.css");
    const Header = clientReference({
      id: "app/Header.client.tsx#Header",
      assets: [shared, stylesheet("/assets/Header.css")],
    });
    const Footer = clientReference({
      id: "app/Footer.client.tsx#Footer",
      assets: [shared, stylesheet("/assets/Footer.css")],
    });
    // Defined but never rendered: must contribute nothing.
    clientReference({
      id: "app/Unused.client.tsx#Unused",
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

    const prepared: unknown[] = [];
    const { done, onStreamDone } = streamDone();
    void decodePayloadStream(streamFromString(text), {
      onStreamDone,
      prepareAssets(list) {
        prepared.push(...list);
      },
      resolveClientReference: () => "fig-client",
    });
    expect(await done).toEqual({ status: "complete" });

    // Shared asset deduped across the two references that rendered.
    expect(prepared).toEqual([
      { href: "/assets/shared.css", kind: "stylesheet" },
      { href: "/assets/Header.css", kind: "stylesheet" },
      { href: "/assets/Footer.css", kind: "stylesheet" },
    ]);
  });

  it("dedupes a font against an equivalent preload-as-font on a client row", async () => {
    const Text = clientReference({
      id: "app/Text.client.tsx#Text",
      assets: [
        font("/assets/Inter.woff2", "font/woff2"),
        // Same asset, expressed as a preload: both share the preload-font key
        // space, so only the first survives serialization.
        preload("/assets/Inter.woff2", "font", {
          type: "font/woff2",
          crossorigin: "anonymous",
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

  it("streams promise-valued children as lazy rows", async () => {
    const pending = deferred<string>();
    const child = pending.promise.then((value) =>
      createElement("span", null, value),
    );
    const result = renderToPayloadStream(
      createElement("div", null, "Before ", child),
    );

    pending.resolve("Ready");
    await result.allReady;

    expect(parseTestPayloadRows(await readStream(result.stream))).toEqual([
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
        value: graphElement(3, "span", { children: "Ready" }),
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
    const { decode } = decodeTestPayloadRows(rows, {
      resolveClientReference: () => "fig-viewer",
    });

    const decoded = (await decode) as FigElement;
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

  it("serializes rich server values inside Map and Set props", async () => {
    const Viewer = clientReference<{ value: Map<string, unknown> }>({
      id: "app/Viewer.client.tsx#Viewer",
    });
    const Nested = clientReference<{ label: string }>({
      id: "app/Nested.client.tsx#Nested",
    });
    const payload = new Map<string, unknown>([
      ["element", createElement("span", null, "Nested")],
      ["promise", Promise.resolve("Ready")],
      ["client", Nested],
      ["set", new Set([createElement("em", null, "Set child")])],
    ]);

    const { decode } = decodeTestPayloadRows(
      await renderToPayloadRows(createElement(Viewer, { value: payload })),
      {
        resolveClientReference: ({ id }) =>
          id.includes("Viewer") ? "fig-viewer" : "fig-nested",
      },
    );

    const decoded = (await decode) as FigElement;
    if (!isValidElement(decoded)) throw new Error("Expected decoded element.");
    const value = decoded.props.value as Map<string, unknown>;

    expect(value.get("element")).toMatchObject({
      props: { children: "Nested" },
      type: "span",
    });
    await expect(value.get("promise")).resolves.toBe("Ready");

    const Client = value.get("client") as ElementType;
    expect(
      unwrapFunctionComponent(createElement(Client, { label: "ok" })),
    ).toMatchObject({
      props: { label: "ok" },
      type: "fig-nested",
    });

    const setValues = [...(value.get("set") as Set<unknown>)];
    expect(setValues[0]).toMatchObject({
      props: { children: "Set child" },
      type: "em",
    });
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
    });
    const shared = { label: "shared" };
    const pending = deferred<typeof shared>();

    const result = renderToPayloadStream(
      createElement(Viewer, { later: pending.promise, value: shared }),
    );
    pending.resolve(shared);
    await result.allReady;

    const { done, onStreamDone } = streamDone();
    const decode = decodePayloadStream(result.stream, {
      onStreamDone,
      resolveClientReference: () => "fig-viewer",
    });
    const decoded = (await decode) as FigElement;
    if (!isValidElement(decoded)) throw new Error("Expected decoded element.");
    expect(await done).toEqual({ status: "complete" });

    await expect(decoded.props.later).resolves.toBe(decoded.props.value);
  });

  it("resolves lazy refs to objects first defined in sibling content", async () => {
    const Viewer = clientReference<{ value: unknown }>({
      id: "app/Viewer.client.tsx#Viewer",
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
        createElement(Viewer, { value: shared }),
        createElement(SuspendedViewer, null),
      ),
    );
    pending.resolve(shared);
    await result.allReady;

    const { done, onStreamDone } = streamDone();
    const decode = decodePayloadStream(result.stream, {
      onStreamDone,
      resolveClientReference: () => "fig-viewer",
    });
    const root = (await decode) as FigElement;
    expect(await done).toEqual({ status: "complete" });
    if (!isValidElement(root) || !Array.isArray(root.props.children)) {
      throw new Error("Expected decoded root children.");
    }

    const [inlineChild, lazyChild] = root.props.children as [
      FigElement,
      FigElement,
    ];
    const inline = renderNode(inlineChild) as FigElement;
    // The outlined row serializes a $fig ref back to the object first defined
    // in the root row; decoding must resolve it to the same instance.
    const outlined = renderNode(lazyChild) as FigElement;
    if (!isValidElement(inline) || !isValidElement(outlined)) {
      throw new Error("Expected decoded client elements.");
    }

    expect(outlined.props.value).toBe(inline.props.value);
  });

  it("preserves cyclic objects in rendered client props", async () => {
    const Viewer = clientReference<{ value: unknown }>({
      id: "app/Viewer.client.tsx#Viewer",
    });
    const value: Record<string, unknown> = { label: "cycle" };
    value.self = value;

    const { decode } = decodeTestPayloadRows(
      await renderToPayloadRows(createElement(Viewer, { value })),
      {
        resolveClientReference: () => "fig-viewer",
      },
    );

    const decoded = (await decode) as FigElement;
    if (!isValidElement(decoded)) throw new Error("Expected decoded element.");

    expect(decoded.props.value.self).toBe(decoded.props.value);
  });

  it("rolls back graph refs from client elements discarded into lazy errors", async () => {
    const Viewer = clientReference<{
      bad?: () => void;
      shared: unknown;
    }>({
      id: "app/Viewer.client.tsx#Viewer",
    });
    const shared = { label: "shared" };
    const rows = await renderToPayloadRows([
      createElement(Viewer, {
        bad: () => undefined,
        shared,
      }),
      createElement(Viewer, { shared }),
    ]);
    const { decode, done } = decodeTestPayloadRows(rows, {
      resolveClientReference: () => "fig-viewer",
    });

    const decoded = await decode;
    expect(await done).toEqual({ status: "complete" });
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
    });
    const child = createElement("span", null, "shared child");
    const fallback = new Map<unknown, unknown>([["state", "ready"]]);

    const { decode } = decodeTestPayloadRows(
      await renderToPayloadRows(
        createElement(Viewer, {
          children: child,
          fallback,
          mirror: child,
        }),
      ),
      { resolveClientReference: () => "fig-viewer" },
    );

    const decoded = (await decode) as FigElement;
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
    });

    const { decode } = decodeTestPayloadRows(
      await renderToPayloadRows(
        createElement(Viewer, { children: { custom: "data" } }),
      ),
      { resolveClientReference: () => "fig-viewer" },
    );

    const decoded = (await decode) as FigElement;
    if (!isValidElement(decoded)) throw new Error("Expected decoded element.");

    expect(decoded.props.children).toEqual({ custom: "data" });
  });

  it("reports invalid Date payload values as root errors", async () => {
    const Viewer = clientReference<{ value: unknown }>({
      id: "app/Viewer.client.tsx#Viewer",
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
    });
    const value = Promise.resolve("Loaded");

    const rows = await renderToPayloadRows(
      createElement(Viewer, {
        $fig: "literal",
        child: createElement("span", null, "Child"),
        promise: value,
      }),
    );
    const { decode } = decodeTestPayloadRows(rows, {
      resolveClientReference: () => "fig-viewer",
    });

    const decoded = (await decode) as FigElement;
    if (!isValidElement(decoded)) throw new Error("Expected decoded element.");

    expect(decoded.props.$fig).toBe("literal");
    expect(decoded.props.child).toMatchObject({
      props: { children: "Child" },
      type: "span",
    });
    expect(decoded.props.promise).toBeInstanceOf(Promise);
  });

  it("decodes JSON payload rows split across many chunks", () => {
    const rows: PayloadRow[] = [];
    const decoder = jsonPayloadCodec.createDecoder((row) => {
      rows.push(row);
    });
    const row: PayloadRow = {
      id: 0,
      tag: "model",
      value: "x".repeat(2000),
    };
    const encoded = JSON.stringify(row) + "\n";
    const encoder = new TextEncoder();

    for (let index = 0; index < encoded.length; index += 17) {
      decoder.decode(encoder.encode(encoded.slice(index, index + 17)));
    }
    decoder.flush();

    expect(rows).toEqual([row]);
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

  it("preserves ViewTransition as a client-visible structural element", async () => {
    const rows = await renderToPayloadRows(
      createElement(
        ViewTransition,
        { default: "payload-vt", name: "payload-card" },
        createElement("section", null, "Card"),
      ),
    );

    expect(rows[0]).toEqual({
      id: 0,
      tag: "model",
      value: graphElement(
        1,
        { $fig: "view-transition" },
        {
          children: graphElement(2, "section", { children: "Card" }),
          default: "payload-vt",
          name: "payload-card",
        },
      ),
    });

    const { decode } = decodeTestPayloadRows(rows);
    const decoded = await decode;

    expect(isValidElement(decoded)).toBe(true);
    if (!isValidElement(decoded)) return;
    expect(decoded.type).toBe(ViewTransition);
    expect(decoded.props.name).toBe("payload-card");
  });

  it("decodes completed rows back into Fig nodes", async () => {
    const LikeButton = clientReference<{ initialCount: number }>({
      id: "app/LikeButton.client.tsx#LikeButton",
    });

    const rows = await renderToPayloadRows(
      createElement(LikeButton, { initialCount: 12 }),
    );
    function ClientLikeButton() {
      return null;
    }

    const { decode } = decodeTestPayloadRows(rows, {
      resolveClientReference() {
        return ClientLikeButton;
      },
    });
    const node = await decode;

    expect(node).toMatchObject({
      key: null,
      props: { initialCount: 12 },
      type: ClientLikeButton,
    });
  });

  it("rejects functions passed across the server-to-client boundary", async () => {
    const Button = clientReference<{ action: () => void }>({
      id: "app/Button.client.tsx#Button",
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

  it("decodes error rows into digest-carrying errors with a generic message", async () => {
    const { decode, done } = decodeTestPayloadRows([
      { id: 0, tag: "error", value: { digest: "digest-9" } },
    ]);

    let thrown: unknown;
    try {
      void (await decode);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error & { digest?: string }).digest).toBe("digest-9");
    expect((thrown as Error).message).toBe("The server render failed.");
    // An error row is a delivered result, not a transport failure.
    expect(await done).toEqual({ status: "complete" });
  });

  it("processes streamed rows incrementally", async () => {
    const { done, onStreamDone } = streamDone();
    const source = controlledTextStream();
    const decode = decodePayloadStream(source.stream, { onStreamDone });
    let resolved = false;
    void decode.then(() => {
      resolved = true;
    });

    source.write('{"id":0,"tag":"model"');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(resolved).toBe(false);

    source.write(',"value":"Ready"}\n');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(resolved).toBe(true);
    expect(await decode).toBe("Ready");

    source.close();
    expect(await done).toEqual({ status: "complete" });
  });

  it("pipes readable streams into a payload decoder", async () => {
    const { done, onStreamDone } = streamDone();
    const decode = decodePayloadStream(
      streamFromString(
        await renderToPayloadText(createElement("p", null, "Hi")),
      ),
      { onStreamDone },
    );

    expect(await decode).toMatchObject({
      props: { children: "Hi" },
      type: "p",
    });
    expect(await done).toEqual({ status: "complete" });
  });

  it("flushes a final payload row without a trailing newline", async () => {
    const { done, onStreamDone } = streamDone();
    const decode = decodePayloadStream(
      streamFromString('{"id":0,"tag":"model","value":"Done"}'),
      { onStreamDone },
    );

    expect(await decode).toBe("Done");
    expect(await done).toEqual({ status: "complete" });
  });

  it("cancelling a payload decode leaves no unhandled rejection", async () => {
    const pending = deferred<string>();

    function Slow() {
      return createElement("p", null, readPromise(pending.promise));
    }

    const result = renderToPayloadStream(
      createElement("section", null, createElement(Slow, null)),
    );
    const { done, onStreamDone } = streamDone();
    const controller = new AbortController();
    const decode = decodePayloadStream(result.stream, {
      onStreamDone,
      signal: controller.signal,
    });
    void (await decode);

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      // Client disconnect: the decoder aborts without awaiting allReady.
      controller.abort(new Error("client disconnected"));
      expect(await done).toEqual({ status: "aborted" });
      // unhandledRejection fires after the microtask queue drains; give it
      // two macrotasks to surface before attaching our own handler.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }

    expect(unhandled).toEqual([]);
    // Awaiting callers still observe the render-side rejection.
    await expect(result.allReady).rejects.toThrow("Payload decode aborted.");
  });

  it("aborts payload renders from the render signal", async () => {
    const pending = deferred<string>();
    const controller = new AbortController();

    function Slow() {
      return createElement("p", null, readPromise(pending.promise));
    }

    const result = renderToPayloadStream(createElement(Slow, null), {
      signal: controller.signal,
    });
    controller.abort(new Error("request closed"));

    await expect(result.allReady).rejects.toThrow("request closed");
  });

  it("rejects malformed payload streams as real failures", async () => {
    const { done, onStreamDone } = streamDone();
    const decode = decodePayloadStream(streamFromString("{not-json}\n"), {
      onStreamDone,
    });

    await expect(decode).rejects.toThrow(SyntaxError);
    expect((await done).status).toBe("failed");
  });

  it("cancels payload streams when row decoding throws", async () => {
    let cancelReason: unknown;
    const stream = new ReadableStream<Uint8Array>({
      cancel(reason) {
        cancelReason = reason;
      },
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{not-json}\n"));
      },
    });

    const { done, onStreamDone } = streamDone();
    const decode = decodePayloadStream(stream, { onStreamDone });
    const completion = await done;
    if (completion.status !== "failed") {
      throw new Error("Expected a failed completion.");
    }
    expect(completion.error).toBeInstanceOf(SyntaxError);
    expect(cancelReason).toBeInstanceOf(SyntaxError);
    await expect(decode).rejects.toThrow(SyntaxError);
  });
});

describe("payload flow control", () => {
  async function readChunksSlowly(
    stream: ReadableStream<Uint8Array>,
  ): Promise<string[]> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];

    for (;;) {
      const { done, value } = await reader.read();
      if (done) return chunks;
      chunks.push(decoder.decode(value, { stream: true }));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  it("resolves allReady unread, then flushes one blocked row per pull", async () => {
    const first = deferred<string>();
    const second = deferred<string>();

    function Message(props: { promise: Promise<string> }) {
      return createElement("span", null, readPromise(props.promise));
    }

    const result = renderToPayloadStream(
      createElement(
        "div",
        null,
        createElement(Message, { promise: first.promise }),
        createElement(Message, { promise: second.promise }),
      ),
      { highWaterMark: 1 },
    );

    first.resolve("First");
    second.resolve("Second");
    // Readiness is task-driven, so it must settle with nothing reading.
    await result.allReady;

    const chunks = await readChunksSlowly(result.stream);

    // Each encoded row is its own chunk; a 1-byte mark blocks after every
    // enqueue, so each remaining row waits for a consumer pull.
    expect(chunks.length).toBe(3);
    for (const chunk of chunks) {
      expect(chunk.endsWith("\n")).toBe(true);
    }

    const rows = parseTestPayloadRows(chunks.join(""));
    expect(rows.map((row) => row.tag)).toEqual(["model", "model", "model"]);
    expect(JSON.stringify(rows)).toContain("First");
    expect(JSON.stringify(rows)).toContain("Second");
  });

  it("rejects allReady as cancelled when the consumer cancels while blocked", async () => {
    const pending = deferred<string>();

    function Message() {
      return createElement("span", null, readPromise(pending.promise));
    }

    const result = renderToPayloadStream(
      createElement("div", null, createElement(Message, null)),
      { highWaterMark: 1 },
    );

    // The root model row fills the queue past the mark; nothing reads it.
    await Promise.resolve();
    await result.stream.cancel(new Error("consumer gone"));

    await expect(result.allReady).rejects.toSatisfy((reason: unknown) => {
      expect(reason).toBeInstanceOf(Error);
      return true;
    });

    // A late resolution must be ignored, not crash into a cancelled stream.
    pending.resolve("late");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });

  it("clamps a zero high-water mark instead of deadlocking", async () => {
    const rows = await renderToPayloadRows(createElement("p", null, "Ready"), {
      highWaterMark: 0,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.tag).toBe("model");
    expect(JSON.stringify(rows[0])).toContain("Ready");
  });
});
