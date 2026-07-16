import { describe, expect, it } from "vitest";
import {
  createElement,
  type ElementType,
  type FigElement,
  type FigNode,
  Fragment,
  isValidElement,
  Suspense,
} from "./index.ts";
import {
  type RenderDispatcher,
  readThenable,
  setCurrentDispatcher,
} from "./internal.ts";
import {
  assertPayloadCodecMatches,
  encodePayloadDataEntries,
  jsonPayloadCodec,
  payloadCodecIdFromContentType,
  type PayloadRow,
} from "./payload-format.ts";
import {
  createPayloadClientReferenceResolver,
  decodePayloadStream,
  type PayloadDecodeCompletion,
  type PayloadDecodeOptions,
} from "./payload.ts";
import * as payloadApi from "./payload.ts";

// The async-observer test watches Node's unhandled-rejection reporting; the
// package compiles without @types/node, so declare the two hooks it uses.
declare const process: {
  on(event: "unhandledRejection", listener: (reason: unknown) => void): void;
  off(event: "unhandledRejection", listener: (reason: unknown) => void): void;
};

// ---------------------------------------------------------------------------
// Row and stream helpers: these tests hand-author wire rows; the render →
// decode round trip lives in fig-server's payload-decode tests.

type TestModel = unknown;

function obj(value: Record<string, TestModel>): TestModel {
  return { $fig: "object", value };
}

function element(
  type: TestModel,
  props: Record<string, TestModel> = {},
  key: string | null = null,
): TestModel {
  return { $fig: "element", key, props: obj(props), type };
}

function model(id: number, value: TestModel): PayloadRow {
  return { id, tag: "model", value } as PayloadRow;
}

function streamFromRows(
  rows: readonly PayloadRow[],
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const row of rows) {
        controller.enqueue(jsonPayloadCodec.encodeRow(row));
      }
      controller.close();
    },
  });
}

function controlledRowStream(): {
  close(): void;
  fail(error: unknown): void;
  push(row: PayloadRow): void;
  stream: ReadableStream<Uint8Array>;
} {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(innerController) {
      controller = innerController;
    },
  });
  return {
    close: () => controller.close(),
    fail: (error: unknown) => controller.error(error),
    push: (row: PayloadRow) =>
      controller.enqueue(jsonPayloadCodec.encodeRow(row)),
    stream,
  };
}

async function tick(times = 3): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function trackSettled(promise: Promise<unknown>): () => boolean {
  let settled = false;
  void promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  return () => settled;
}

// Render decoded function components the way a real renderer would: under a
// dispatcher whose readPromise throws pending thenables to suspend.
function withTestDispatcher<T>(run: () => T): T {
  const dispatcher = {
    readPromise: readThenable,
  } as Partial<RenderDispatcher> as RenderDispatcher;
  const previous = setCurrentDispatcher(dispatcher);
  try {
    return run();
  } finally {
    setCurrentDispatcher(previous);
  }
}

function evaluateNode(node: FigNode): FigNode {
  if (Array.isArray(node)) return node.map((child) => evaluateNode(child));
  if (!isValidElement(node)) return node;
  if (node.type === Fragment) return evaluateNode(node.props.children);
  if (typeof node.type === "function") {
    return evaluateNode(
      (node.type as ElementType & ((props: FigElement["props"]) => FigNode))(
        node.props,
      ),
    );
  }
  return {
    ...node,
    props: { ...node.props, children: evaluateNode(node.props.children) },
  };
}

function renderNode(node: FigNode): FigNode {
  return withTestDispatcher(() => evaluateNode(node));
}

function decodeRows(
  rows: readonly PayloadRow[],
  options?: PayloadDecodeOptions,
) {
  return decodePayloadStream(streamFromRows(rows), options);
}

// Captures onStreamDone so tests can await the end of ingestion.
function streamDone(): {
  done: Promise<PayloadDecodeCompletion>;
  onStreamDone: (result: PayloadDecodeCompletion) => void;
} {
  let resolve!: (result: PayloadDecodeCompletion) => void;
  const done = new Promise<PayloadDecodeCompletion>((innerResolve) => {
    resolve = innerResolve;
  });
  return { done, onStreamDone: resolve };
}

// Rendering gate-held content suspends by throwing the gate's thenable.
function expectSuspends(node: FigNode): void {
  let thrown: unknown;
  try {
    renderNode(node);
  } catch (error) {
    thrown = error;
  }
  expect(typeof (thrown as PromiseLike<unknown>)?.then).toBe("function");
}

describe("decodePayloadStream", () => {
  it("keeps the public runtime surface to the decoder and its resolver factory", () => {
    expect(Object.keys(payloadApi)).toEqual([
      "createPayloadClientReferenceResolver",
      "decodePayloadStream",
    ]);
  });

  it("resolves the root tree and reports completion", async () => {
    const { done, onStreamDone } = streamDone();
    const decode = decodeRows(
      [
        model(
          0,
          element("article", {
            children: [element("h1", { children: "Title" }), "body text"],
          }),
        ),
      ],
      { onStreamDone },
    );

    const root = (await decode) as FigElement;
    expect(isValidElement(root)).toBe(true);
    expect(root.type).toBe("article");
    const children = root.props.children as [FigElement, string];
    expect(children[0].type).toBe("h1");
    expect(children[0].props.children).toBe("Title");
    expect(children[1]).toBe("body text");

    expect(await done).toEqual({ status: "complete" });
  });

  it("decodes fragments, suspense, and view transitions", async () => {
    const decode = decodeRows([
      model(
        0,
        element(
          { $fig: "suspense" },
          {
            children: element({ $fig: "fragment" }, { children: "inner" }),
            fallback: "loading",
          },
        ),
      ),
    ]);

    const root = (await decode) as FigElement;
    expect(root.type).toBe(Suspense);
    expect((root.props.children as FigElement).type).toBe(Fragment);
  });

  it("preserves shared references across rows", async () => {
    const { done, onStreamDone } = streamDone();
    const decode = decodeRows(
      [
        model(
          0,
          element("div", {
            shared: { $fig: "object", id: 7, value: { name: "config" } },
            hole: { $fig: "lazy", id: 1 },
          }),
        ),
        model(1, element("span", { again: { $fig: "ref", id: 7 } })),
      ],
      { onStreamDone },
    );

    const root = (await decode) as FigElement;
    await done;
    const hole = root.props.hole as FigElement;
    const filled = renderNode(hole) as FigElement;
    expect(filled.props.again).toBe(root.props.shared);
  });

  it("decodes cyclic graphs", async () => {
    const decode = decodeRows([
      model(
        0,
        element("div", {
          node: {
            $fig: "object",
            id: 3,
            value: { self: { $fig: "ref", id: 3 } },
          },
        }),
      ),
    ]);

    const root = (await decode) as FigElement;
    const node = root.props.node as { self: unknown };
    expect(node.self).toBe(node);
  });

  it("resolves promise holes when their rows arrive", async () => {
    const { done, onStreamDone } = streamDone();
    const source = controlledRowStream();
    const decode = decodePayloadStream(source.stream, { onStreamDone });

    source.push(model(0, element("div", { data: { $fig: "promise", id: 1 } })));
    const root = (await decode) as FigElement;
    const promise = root.props.data as Promise<unknown>;
    const settled = trackSettled(promise);
    await tick();
    expect(settled()).toBe(false);

    source.push(model(1, "streamed value"));
    source.close();
    await expect(promise).resolves.toBe("streamed value");
    expect(await done).toEqual({ status: "complete" });
  });

  it("suspends lazy holes and reveals them when rows arrive", async () => {
    const { done, onStreamDone } = streamDone();
    const source = controlledRowStream();
    const decode = decodePayloadStream(source.stream, { onStreamDone });

    source.push(
      model(0, element("div", { children: { $fig: "lazy", id: 1 } })),
    );
    const root = (await decode) as FigElement;
    const hole = root.props.children as FigElement;

    let thrown: unknown;
    try {
      renderNode(hole);
    } catch (error) {
      thrown = error;
    }
    expect(typeof (thrown as PromiseLike<unknown>)?.then).toBe("function");

    source.push(model(1, element("p", { children: "late" })));
    source.close();
    await done;

    const filled = renderNode(hole) as FigElement;
    expect(filled.type).toBe("p");
    expect(filled.props.children).toBe("late");
  });

  it("rejects value when the stream fails before the root row", async () => {
    const { done, onStreamDone } = streamDone();
    const source = controlledRowStream();
    const decode = decodePayloadStream(source.stream, { onStreamDone });
    const failure = new Error("network down");

    source.fail(failure);

    await expect(decode).rejects.toBe(failure);
    expect(await done).toEqual({
      status: "failed",
      error: failure,
    });
  });

  it("rejects value with a digest-carrying error for a root error row", async () => {
    const { done, onStreamDone } = streamDone();
    const decode = decodeRows(
      [{ id: 0, tag: "error", value: { digest: "d-42", message: "boom" } }],
      { onStreamDone },
    );

    await expect(decode).rejects.toMatchObject({
      digest: "d-42",
      message: "boom",
    });
    // The stream itself stayed well-formed: ingestion completed.
    expect(await done).toEqual({ status: "complete" });
  });

  it("rejects a hole through its error row while the root stays fulfilled", async () => {
    const { done, onStreamDone } = streamDone();
    const holeErrors: unknown[] = [];
    const decode = decodeRows(
      [
        model(0, element("div", { children: { $fig: "lazy", id: 1 } })),
        { id: 1, tag: "error", value: { digest: "hole-digest" } },
      ],
      { onHoleError: (error) => holeErrors.push(error), onStreamDone },
    );

    const root = (await decode) as FigElement;
    expect(root.type).toBe("div");
    expect(await done).toEqual({ status: "complete" });

    let thrown: unknown;
    try {
      void renderNode(root.props.children as FigElement);
    } catch (error) {
      thrown = error;
    }
    expect((thrown as { digest?: string }).digest).toBe("hole-digest");
    expect(holeErrors).toEqual([thrown]);
  });

  it("rejects unresolved holes when the stream truncates after the root", async () => {
    const { done, onStreamDone } = streamDone();
    const source = controlledRowStream();
    const decode = decodePayloadStream(source.stream, { onStreamDone });

    source.push(model(0, element("div", { data: { $fig: "promise", id: 1 } })));
    const root = (await decode) as FigElement;
    source.close();

    expect((await done).status).toBe("failed");
    await expect(root.props.data as Promise<unknown>).rejects.toThrow(
      "Payload stream ended before all referenced rows arrived.",
    );
  });

  it("rejects unresolved holes on post-root transport failure, keeping value fulfilled", async () => {
    const { done, onStreamDone } = streamDone();
    const source = controlledRowStream();
    const decode = decodePayloadStream(source.stream, { onStreamDone });
    const failure = new Error("connection reset");

    source.push(model(0, element("div", { data: { $fig: "promise", id: 1 } })));
    const root = (await decode) as FigElement;
    source.fail(failure);

    expect(await done).toEqual({
      status: "failed",
      error: failure,
    });
    await expect(root.props.data as Promise<unknown>).rejects.toBe(failure);
    await expect(decode).resolves.toBe(root);
  });

  it("aborts idempotently, rejecting unresolved holes with an internal abort reason", async () => {
    const { done, onStreamDone } = streamDone();
    const holeErrors: unknown[] = [];
    const controller = new AbortController();
    const source = controlledRowStream();
    const decode = decodePayloadStream(source.stream, {
      onStreamDone,
      onHoleError: (error) => holeErrors.push(error),
      signal: controller.signal,
    });

    source.push(model(0, element("div", { data: { $fig: "promise", id: 1 } })));
    const root = (await decode) as FigElement;

    controller.abort("navigated away");
    controller.abort("second call is a no-op");

    expect(await done).toEqual({ status: "aborted" });
    const reason = await (root.props.data as Promise<unknown>).catch(
      (error: unknown) => error,
    );
    expect(reason).toMatchObject({ name: "PayloadDecodeAbortedError" });
    expect((reason as Error & { cause?: unknown }).cause).toBe(
      "navigated away",
    );
    expect(holeErrors).toEqual([]);
  });

  it("aborts through options.signal, including an already-aborted signal", async () => {
    const liveDone = streamDone();
    const live = new AbortController();
    const source = controlledRowStream();
    const decode = decodePayloadStream(source.stream, {
      onStreamDone: liveDone.onStreamDone,
      signal: live.signal,
    });
    live.abort("stop");
    expect(await liveDone.done).toEqual({ status: "aborted" });
    const reason = await decode.catch((error: unknown) => error);
    expect(reason).toMatchObject({ name: "PayloadDecodeAbortedError" });

    const preDone = streamDone();
    const preAborted = AbortSignal.abort("already done");
    const second = decodePayloadStream(controlledRowStream().stream, {
      onStreamDone: preDone.onStreamDone,
      signal: preAborted,
    });
    expect(await preDone.done).toEqual({ status: "aborted" });
    await expect(second).rejects.toMatchObject({
      name: "PayloadDecodeAbortedError",
    });
  });

  it("hydrates decoded data rows through the capability", async () => {
    const { done, onStreamDone } = streamDone();
    const hydrated: unknown[] = [];
    void decodeRows(
      [
        {
          tag: "data",
          value: encodePayloadDataEntries([
            { key: ["user", "1"], value: { name: "Ada" } },
          ]),
        } as PayloadRow,
        model(0, null),
      ],
      {
        hydrate: (entries) => {
          hydrated.push(...entries);
          return true;
        },
        onStreamDone,
      },
    );

    await done;
    expect(hydrated).toEqual([{ key: ["user", "1"], value: { name: "Ada" } }]);
  });

  it("passes assets to prepareAssets on arrival and gates the dependent row", async () => {
    let releaseGate = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const prepared: unknown[] = [];
    const { done, onStreamDone } = streamDone();
    const source = controlledRowStream();
    const decode = decodePayloadStream(source.stream, {
      onStreamDone,
      prepareAssets: (assets) => {
        prepared.push(...assets);
        return gate;
      },
    });

    source.push({
      for: 0,
      tag: "assets",
      value: [{ href: "/app.css", kind: "stylesheet" }],
    } as PayloadRow);
    await tick();
    // Assets are prepared as soon as their row arrives, before the model.
    expect(prepared).toEqual([{ href: "/app.css", kind: "stylesheet" }]);

    source.push(model(0, element("div", { children: "styled" })));
    source.close();
    const valueSettled = trackSettled(decode);
    await tick();
    expect(valueSettled()).toBe(false);

    releaseGate();
    const root = (await decode) as FigElement;
    expect(root.type).toBe("div");
    expect(await done).toEqual({ status: "complete" });
  });

  it("reveals gated content when the asset gate rejects", async () => {
    const decode = decodeRows(
      [
        {
          for: 0,
          tag: "assets",
          value: [{ href: "/broken.css", kind: "stylesheet" }],
        } as PayloadRow,
        model(0, element("div", {})),
      ],
      { prepareAssets: () => Promise.reject(new Error("stylesheet failed")) },
    );

    const root = (await decode) as FigElement;
    expect(root.type).toBe("div");
  });

  it("reveals arrived-but-gated content when the decode aborts", async () => {
    const { done, onStreamDone } = streamDone();
    const controller = new AbortController();
    const source = controlledRowStream();
    const decode = decodePayloadStream(source.stream, {
      onStreamDone,
      prepareAssets: () => new Promise<void>(() => undefined),
      signal: controller.signal,
    });

    source.push({
      for: 0,
      tag: "assets",
      value: [{ href: "/slow.css", kind: "stylesheet" }],
    } as PayloadRow);
    source.push(model(0, element("div", {})));
    await tick();

    controller.abort();
    expect(await done).toEqual({ status: "aborted" });
    const root = (await decode) as FigElement;
    expect(root.type).toBe("div");
  });

  it("starts client reference loads at row arrival and renders islands", async () => {
    const loads: string[] = [];
    const Widget = (props: { label: string }) =>
      createElement("button", null, `widget:${props.label}`);
    const { done, onStreamDone } = streamDone();
    const source = controlledRowStream();
    const decode = decodePayloadStream(source.stream, {
      onStreamDone,
      resolveClientReference: (reference) => {
        loads.push(reference.id);
        return Promise.resolve(Widget);
      },
    });

    source.push({
      id: 1,
      tag: "client",
      value: { id: "src/Widget.tsx#Widget", exportName: "Widget" },
    });
    await tick();
    // Async resolution overlaps the rest of the stream.
    expect(loads).toEqual(["src/Widget.tsx#Widget"]);

    source.push(model(0, element({ $fig: "client", id: 1 }, { label: "hi" })));
    source.close();

    const root = (await decode) as FigElement;
    await done;
    const rendered = renderNode(root) as FigElement;
    expect(rendered.type).toBe("button");
    expect(rendered.props.children).toBe("widget:hi");
    expect(loads).toHaveLength(1);
  });

  it("short-circuits client references through resolveClientReference", async () => {
    const decode = decodeRows(
      [
        {
          id: 1,
          tag: "client",
          value: { id: "src/Widget.tsx#Widget", exportName: "Widget" },
        },
        model(0, element({ $fig: "client", id: 1 }, { label: "solid" })),
      ],
      {
        resolveClientReference: () => (props: { label: string }) =>
          createElement("em", null, props.label),
      },
    );

    const root = (await decode) as FigElement;
    const rendered = renderNode(root) as FigElement;
    expect(rendered.type).toBe("em");
    expect(rendered.props.children).toBe("solid");
  });

  it("keeps ungated resolved references identity-stable across decodes", async () => {
    const Widget = (props: { label: string }) =>
      createElement("em", null, props.label);
    const rows: PayloadRow[] = [
      {
        id: 1,
        tag: "client",
        value: { id: "src/Widget.tsx#Widget", exportName: "Widget" },
      },
      model(0, element({ $fig: "client", id: 1 }, { label: "solid" })),
    ];

    // Re-decoding the same reference (a payload refresh) must produce the
    // same element type, so reconciliation updates the client component
    // instead of remounting it and dropping its state.
    const first = (await decodeRows(rows, {
      resolveClientReference: () => Widget,
    })) as FigElement;
    const second = (await decodeRows(rows, {
      resolveClientReference: () => Widget,
    })) as FigElement;
    expect(first.type).toBe(Widget);
    expect(second.type).toBe(Widget);
  });

  it("keeps gated references identity-stable across decodes sharing a stateful resolver", async () => {
    // The fig-start shape: the row carries the reference's own stylesheet
    // and prepareAssets returns a gate. With a plain function the decoder
    // mints a fresh gate wrapper per decode, so a stable resolve callback
    // alone cannot keep the island's identity — the stateful resolver is
    // the contract for that.
    const Widget = (props: { label: string }) =>
      createElement("em", null, props.label);
    const rows: PayloadRow[] = [
      {
        id: 1,
        tag: "client",
        value: {
          id: "src/Widget.tsx#Widget",
          exportName: "Widget",
          assets: [{ href: "/widget.css", kind: "stylesheet" }],
        },
      },
      model(0, element({ $fig: "client", id: 1 }, { label: "solid" })),
    ];
    const options: PayloadDecodeOptions = {
      prepareAssets: () => Promise.resolve(),
      resolveClientReference: () => Widget,
    };

    const bare = (await decodeRows(rows, options)) as FigElement;
    const bareAgain = (await decodeRows(rows, options)) as FigElement;
    expect(bareAgain.type).not.toBe(bare.type);

    const resolver = createPayloadClientReferenceResolver(() => Widget);
    const cached = { ...options, resolveClientReference: resolver };
    const first = (await decodeRows(rows, cached)) as FigElement;
    const second = (await decodeRows(rows, cached)) as FigElement;
    expect(second.type).toBe(first.type);
    const rendered = renderNode(
      createElement(first.type as ElementType, { label: "solid" }),
    ) as FigElement;
    expect(rendered.type).toBe("em");

    // Dropping the entry hands identity back to the caller (HMR, manifest
    // swaps): the next decode mints a fresh wrapper.
    resolver.delete("src/Widget.tsx#Widget");
    const third = (await decodeRows(rows, cached)) as FigElement;
    expect(third.type).not.toBe(first.type);
  });

  it("keeps cached identity stable across gated and ungated decodes", async () => {
    // fig-start's initial segment decodes ungated while navigations gate, so
    // the same reference id must resolve to one component either way.
    const Widget = () => createElement("em", null, "island");
    const resolver = createPayloadClientReferenceResolver(() => Widget);
    const rowsWith = (assets: boolean): PayloadRow[] => [
      {
        id: 1,
        tag: "client",
        value: {
          id: "src/Widget.tsx#Widget",
          ...(assets
            ? { assets: [{ href: "/widget.css", kind: "stylesheet" }] }
            : {}),
        },
      },
      model(0, element({ $fig: "client", id: 1 }, {})),
    ];

    const ungated = (await decodeRows(rowsWith(false), {
      resolveClientReference: resolver,
    })) as FigElement;
    const gated = (await decodeRows(rowsWith(true), {
      prepareAssets: () => Promise.resolve(),
      resolveClientReference: resolver,
    })) as FigElement;
    expect(gated.type).toBe(ungated.type);
  });

  it("resolves a cached async reference once and keeps its identity", async () => {
    const Widget = (props: { label: string }) =>
      createElement("em", null, props.label);
    const loads: string[] = [];
    const resolver = createPayloadClientReferenceResolver((reference) => {
      loads.push(reference.id);
      return Promise.resolve(Widget);
    });
    const rows: PayloadRow[] = [
      { id: 1, tag: "client", value: { id: "src/Widget.tsx#Widget" } },
      model(0, element({ $fig: "client", id: 1 }, { label: "async" })),
    ];
    const options: PayloadDecodeOptions = {
      resolveClientReference: resolver,
    };

    const first = (await decodeRows(rows, options)) as FigElement;
    await tick();
    const second = (await decodeRows(rows, options)) as FigElement;
    expect(second.type).toBe(first.type);
    // The cache hit skips re-resolution entirely.
    expect(loads).toEqual(["src/Widget.tsx#Widget"]);
    const rendered = renderNode(first) as FigElement;
    expect(rendered.type).toBe("em");
    expect(rendered.props.children).toBe("async");
  });

  it("gates each decode's elements on that decode's own assets", async () => {
    // Identity lives on the cached component type; the asset dependency
    // rides each decoded element instance. A newer decode's pending gate
    // holds exactly its own island instances — it can neither re-suspend an
    // island already on screen (the previous decode's elements) nor leak a
    // settled gate to new content that declared fresh assets.
    let releaseGate = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const Widget = () => createElement("i", null, "island");
    const resolver = createPayloadClientReferenceResolver(() => Widget);
    const rows: PayloadRow[] = [
      {
        id: 1,
        tag: "client",
        value: {
          id: "src/Widget.tsx#Widget",
          assets: [{ href: "/widget.css", kind: "stylesheet" }],
        },
      },
      model(0, element({ $fig: "client", id: 1 }, {})),
    ];
    // The creating decode's gate holds the island's first reveal.
    const first = (await decodeRows(rows, {
      prepareAssets: () => gate,
      resolveClientReference: resolver,
    })) as FigElement;
    expectSuspends(first);

    releaseGate();
    await tick();
    expect((renderNode(first) as FigElement).type).toBe("i");

    // A later decode with a still-pending gate: same component identity, but
    // its own island instance waits for its own assets...
    const second = (await decodeRows(rows, {
      prepareAssets: () => new Promise<void>(() => undefined),
      resolveClientReference: resolver,
    })) as FigElement;
    expect(second.type).toBe(first.type);
    expectSuspends(second);

    // ...while the mounted island (the first decode's element) re-renders
    // untouched, and an element minted outside any decode carries no gate.
    expect((renderNode(first) as FigElement).type).toBe("i");
    expect(
      (renderNode(createElement(first.type as ElementType, {})) as FigElement)
        .type,
    ).toBe("i");
  });

  it("gates a ref-outlined client element like an inline one", async () => {
    // Shared elements travel as id-carrying element models and materialize
    // through the object-ref path; the gate attaches there too.
    let releaseGate = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const decode = decodeRows(
      [
        {
          id: 1,
          tag: "client",
          value: {
            id: "src/Widget.tsx#Widget",
            assets: [{ href: "/widget.css", kind: "stylesheet" }],
          },
        },
        model(0, {
          $fig: "element",
          id: 7,
          key: null,
          props: obj({}),
          type: { $fig: "client", id: 1 },
        }),
      ],
      {
        prepareAssets: () => gate,
        resolveClientReference: () => () => createElement("i", null, "island"),
      },
    );

    const root = (await decode) as FigElement;
    expectSuspends(root);

    releaseGate();
    await tick();
    expect((renderNode(root) as FigElement).type).toBe("i");
  });

  it("swallows a rejecting async onStreamDone observer", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      const value = await decodeRows([model(0, "ok")], {
        onStreamDone: () => Promise.reject(new Error("observer exploded")),
      });
      expect(value).toBe("ok");
      // unhandledRejection fires after the microtask queue drains.
      await tick();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }

    expect(unhandled).toEqual([]);
  });

  it("surfaces client reference load failures when the island renders", async () => {
    const { done, onStreamDone } = streamDone();
    const failure = new Error("module fetch failed");
    const decode = decodeRows(
      [
        {
          id: 1,
          tag: "client",
          value: { id: "src/Widget.tsx#Widget", exportName: "Widget" },
        },
        model(0, element({ $fig: "client", id: 1 }, {})),
      ],
      {
        onStreamDone,
        resolveClientReference: () => Promise.reject(failure),
      },
    );

    const root = (await decode) as FigElement;
    // The stream itself is healthy; the failure belongs to the island and
    // propagates through whatever ErrorBoundary covers it.
    expect(await done).toEqual({ status: "complete" });
    await tick();
    expect(() => renderNode(root)).toThrow(failure);
  });

  it("renders a throwing component for unconfigured client references", async () => {
    const decode = decodeRows([
      { id: 1, tag: "client", value: { id: "src/Widget.tsx#Widget" } },
      model(0, element({ $fig: "client", id: 1 }, {})),
    ]);

    const root = (await decode) as FigElement;
    expect(() => renderNode(root)).toThrow(
      'Cannot render client reference "src/Widget.tsx#Widget" because decodePayloadStream was not configured',
    );
  });

  it("gates island reveal on client reference assets without gating the tree", async () => {
    let releaseGate = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const decode = decodeRows(
      [
        {
          id: 1,
          tag: "client",
          value: {
            id: "src/Widget.tsx#Widget",
            exportName: "Widget",
            assets: [{ href: "/widget.css", kind: "stylesheet" }],
          },
        },
        model(
          0,
          element("div", {
            children: element({ $fig: "client", id: 1 }, { label: "x" }),
          }),
        ),
      ],
      {
        prepareAssets: () => gate,
        resolveClientReference: () => () => createElement("i", null, "island"),
      },
    );

    // The tree reveals immediately; only the island waits for its stylesheet.
    const root = (await decode) as FigElement;
    expect(root.type).toBe("div");

    expectSuspends(root.props.children as FigElement);

    releaseGate();
    await tick();
    const rendered = renderNode(
      root.props.children as FigElement,
    ) as FigElement;
    expect(rendered.type).toBe("i");
  });

  it("treats a model referencing an unarrived client row as a protocol failure", async () => {
    const { done, onStreamDone } = streamDone();
    const decode = decodeRows(
      [model(0, element({ $fig: "client", id: 9 }, {}))],
      { onStreamDone },
    );

    await expect(decode).rejects.toThrow(
      "Payload model referenced client row 9 before it arrived.",
    );
    expect((await done).status).toBe("failed");
  });

  it("ignores rows still queued when the decode aborts", async () => {
    const { done, onStreamDone } = streamDone();
    const source = controlledRowStream();
    source.push(model(0, element("div", {})));
    source.close();

    // Abort synchronously, before ingestion gets to read the queued rows.
    const decode = decodePayloadStream(source.stream, {
      onStreamDone,
      signal: AbortSignal.abort(),
    });

    expect(await done).toEqual({ status: "aborted" });
    await expect(decode).rejects.toMatchObject({
      name: "PayloadDecodeAbortedError",
    });
  });
});

describe("payload codec negotiation", () => {
  it("extracts codec ids from content types", () => {
    expect(payloadCodecIdFromContentType(jsonPayloadCodec.contentType)).toBe(
      "json",
    );
    expect(payloadCodecIdFromContentType("text/x-fig-payload")).toBe(null);
    expect(
      payloadCodecIdFromContentType('text/x-fig-payload; codec="binary"'),
    ).toBe("binary");
  });

  it("asserts codec matches, passing missing headers through", () => {
    expect(() =>
      assertPayloadCodecMatches(jsonPayloadCodec, null),
    ).not.toThrow();
    expect(() =>
      assertPayloadCodecMatches(jsonPayloadCodec, "text/x-fig-payload"),
    ).not.toThrow();
    expect(() =>
      assertPayloadCodecMatches(
        jsonPayloadCodec,
        "text/x-fig-payload; codec=binary",
      ),
    ).toThrow('Payload codec mismatch: producer used "binary"');
  });
});
