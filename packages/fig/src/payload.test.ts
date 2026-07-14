import { describe, expect, it } from "vitest";
import {
  createElement,
  type ElementType,
  type FigElement,
  type FigNode,
  Fragment,
  Suspense,
} from "./index.ts";
import {
  isValidElement,
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
import { decodePayloadStream, type PayloadDecodeOptions } from "./payload.ts";
import * as payloadApi from "./payload.ts";

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

describe("decodePayloadStream", () => {
  it("keeps the public runtime surface to the decoder", () => {
    expect(Object.keys(payloadApi)).toEqual(["decodePayloadStream"]);
  });

  it("resolves value with the decoded root tree and completes", async () => {
    const decode = decodeRows([
      model(
        0,
        element("article", {
          children: [element("h1", { children: "Title" }), "body text"],
        }),
      ),
    ]);

    const root = (await decode.value) as FigElement;
    expect(isValidElement(root)).toBe(true);
    expect(root.type).toBe("article");
    const children = root.props.children as [FigElement, string];
    expect(children[0].type).toBe("h1");
    expect(children[0].props.children).toBe("Title");
    expect(children[1]).toBe("body text");

    expect(await decode.completion).toEqual({ status: "complete" });
  });

  it("is not a thenable", () => {
    const decode = decodeRows([model(0, null)]);
    expect("then" in decode).toBe(false);
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

    const root = (await decode.value) as FigElement;
    expect(root.type).toBe(Suspense);
    expect((root.props.children as FigElement).type).toBe(Fragment);
  });

  it("preserves shared references across rows", async () => {
    const decode = decodeRows([
      model(
        0,
        element("div", {
          shared: { $fig: "object", id: 7, value: { name: "config" } },
          hole: { $fig: "lazy", id: 1 },
        }),
      ),
      model(1, element("span", { again: { $fig: "ref", id: 7 } })),
    ]);

    const root = (await decode.value) as FigElement;
    await decode.completion;
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

    const root = (await decode.value) as FigElement;
    const node = root.props.node as { self: unknown };
    expect(node.self).toBe(node);
  });

  it("resolves promise holes when their rows arrive", async () => {
    const source = controlledRowStream();
    const decode = decodePayloadStream(source.stream);

    source.push(model(0, element("div", { data: { $fig: "promise", id: 1 } })));
    const root = (await decode.value) as FigElement;
    const promise = root.props.data as Promise<unknown>;
    const settled = trackSettled(promise);
    await tick();
    expect(settled()).toBe(false);

    source.push(model(1, "streamed value"));
    source.close();
    await expect(promise).resolves.toBe("streamed value");
    expect(await decode.completion).toEqual({ status: "complete" });
  });

  it("suspends lazy holes and reveals them when rows arrive", async () => {
    const source = controlledRowStream();
    const decode = decodePayloadStream(source.stream);

    source.push(
      model(0, element("div", { children: { $fig: "lazy", id: 1 } })),
    );
    const root = (await decode.value) as FigElement;
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
    await decode.completion;

    const filled = renderNode(hole) as FigElement;
    expect(filled.type).toBe("p");
    expect(filled.props.children).toBe("late");
  });

  it("rejects value when the stream fails before the root row", async () => {
    const source = controlledRowStream();
    const decode = decodePayloadStream(source.stream);
    const failure = new Error("network down");

    source.fail(failure);

    await expect(decode.value).rejects.toBe(failure);
    expect(await decode.completion).toEqual({
      status: "failed",
      error: failure,
    });
  });

  it("rejects value with a digest-carrying error for a root error row", async () => {
    const decode = decodeRows([
      { id: 0, tag: "error", value: { digest: "d-42", message: "boom" } },
    ]);

    await expect(decode.value).rejects.toMatchObject({
      digest: "d-42",
      message: "boom",
    });
    // The stream itself stayed well-formed: ingestion completed.
    expect(await decode.completion).toEqual({ status: "complete" });
  });

  it("rejects a hole through its error row while the root stays fulfilled", async () => {
    const decode = decodeRows([
      model(0, element("div", { children: { $fig: "lazy", id: 1 } })),
      { id: 1, tag: "error", value: { digest: "hole-digest" } },
    ]);

    const root = (await decode.value) as FigElement;
    expect(root.type).toBe("div");
    expect(await decode.completion).toEqual({ status: "complete" });

    let thrown: unknown;
    try {
      renderNode(root.props.children as FigElement);
    } catch (error) {
      thrown = error;
    }
    expect((thrown as { digest?: string }).digest).toBe("hole-digest");
  });

  it("rejects unresolved holes when the stream truncates after the root", async () => {
    const source = controlledRowStream();
    const decode = decodePayloadStream(source.stream);

    source.push(model(0, element("div", { data: { $fig: "promise", id: 1 } })));
    const root = (await decode.value) as FigElement;
    source.close();

    const completion = await decode.completion;
    expect(completion.status).toBe("failed");
    await expect(root.props.data as Promise<unknown>).rejects.toThrow(
      "Payload stream ended before all referenced rows arrived.",
    );
  });

  it("rejects unresolved holes on post-root transport failure, keeping value fulfilled", async () => {
    const source = controlledRowStream();
    const decode = decodePayloadStream(source.stream);
    const failure = new Error("connection reset");

    source.push(model(0, element("div", { data: { $fig: "promise", id: 1 } })));
    const root = (await decode.value) as FigElement;
    source.fail(failure);

    expect(await decode.completion).toEqual({
      status: "failed",
      error: failure,
    });
    await expect(root.props.data as Promise<unknown>).rejects.toBe(failure);
    await expect(decode.value).resolves.toBe(root);
  });

  it("aborts idempotently, rejecting unresolved holes with an internal abort reason", async () => {
    const source = controlledRowStream();
    const decode = decodePayloadStream(source.stream);

    source.push(model(0, element("div", { data: { $fig: "promise", id: 1 } })));
    const root = (await decode.value) as FigElement;

    decode.abort("navigated away");
    decode.abort("second call is a no-op");

    expect(await decode.completion).toEqual({ status: "aborted" });
    const reason = await (root.props.data as Promise<unknown>).catch(
      (error: unknown) => error,
    );
    expect(reason).toMatchObject({ name: "PayloadDecodeAbortedError" });
    expect((reason as Error & { cause?: unknown }).cause).toBe(
      "navigated away",
    );
  });

  it("aborts through options.signal, including an already-aborted signal", async () => {
    const live = new AbortController();
    const source = controlledRowStream();
    const decode = decodePayloadStream(source.stream, { signal: live.signal });
    live.abort("stop");
    expect(await decode.completion).toEqual({ status: "aborted" });
    const reason = await decode.value.catch((error: unknown) => error);
    expect(reason).toMatchObject({ name: "PayloadDecodeAbortedError" });

    const preAborted = AbortSignal.abort("already done");
    const second = decodePayloadStream(controlledRowStream().stream, {
      signal: preAborted,
    });
    expect(await second.completion).toEqual({ status: "aborted" });
    await expect(second.value).rejects.toMatchObject({
      name: "PayloadDecodeAbortedError",
    });
  });

  it("hydrates decoded data rows through the capability", async () => {
    const hydrated: unknown[] = [];
    const decode = decodeRows(
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
      },
    );

    await decode.completion;
    expect(hydrated).toEqual([{ key: ["user", "1"], value: { name: "Ada" } }]);
  });

  it("passes assets to prepareAssets on arrival and gates the dependent row", async () => {
    let releaseGate = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const prepared: unknown[] = [];
    const source = controlledRowStream();
    const decode = decodePayloadStream(source.stream, {
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
    const valueSettled = trackSettled(decode.value);
    await tick();
    expect(valueSettled()).toBe(false);

    releaseGate();
    const root = (await decode.value) as FigElement;
    expect(root.type).toBe("div");
    expect(await decode.completion).toEqual({ status: "complete" });
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

    const root = (await decode.value) as FigElement;
    expect(root.type).toBe("div");
  });

  it("reveals arrived-but-gated content when the decode aborts", async () => {
    const source = controlledRowStream();
    const decode = decodePayloadStream(source.stream, {
      prepareAssets: () => new Promise<void>(() => undefined),
    });

    source.push({
      for: 0,
      tag: "assets",
      value: [{ href: "/slow.css", kind: "stylesheet" }],
    } as PayloadRow);
    source.push(model(0, element("div", {})));
    await tick();

    decode.abort();
    expect(await decode.completion).toEqual({ status: "aborted" });
    const root = (await decode.value) as FigElement;
    expect(root.type).toBe("div");
  });

  it("starts client reference loads at row arrival and renders islands", async () => {
    const loads: string[] = [];
    const Widget = (props: { label: string }) =>
      createElement("button", null, `widget:${props.label}`);
    const source = controlledRowStream();
    const decode = decodePayloadStream(source.stream, {
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

    const root = (await decode.value) as FigElement;
    await decode.completion;
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

    const root = (await decode.value) as FigElement;
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
    }).value) as FigElement;
    const second = (await decodeRows(rows, {
      resolveClientReference: () => Widget,
    }).value) as FigElement;
    expect(first.type).toBe(Widget);
    expect(second.type).toBe(Widget);
  });

  it("surfaces client reference load failures when the island renders", async () => {
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
      { resolveClientReference: () => Promise.reject(failure) },
    );

    const root = (await decode.value) as FigElement;
    // The stream itself is healthy; the failure belongs to the island and
    // propagates through whatever ErrorBoundary covers it.
    expect(await decode.completion).toEqual({ status: "complete" });
    await tick();
    expect(() => renderNode(root)).toThrow(failure);
  });

  it("renders a throwing component for unconfigured client references", async () => {
    const decode = decodeRows([
      { id: 1, tag: "client", value: { id: "src/Widget.tsx#Widget" } },
      model(0, element({ $fig: "client", id: 1 }, {})),
    ]);

    const root = (await decode.value) as FigElement;
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
    const root = (await decode.value) as FigElement;
    expect(root.type).toBe("div");

    let thrown: unknown;
    try {
      renderNode(root.props.children as FigElement);
    } catch (error) {
      thrown = error;
    }
    expect(typeof (thrown as PromiseLike<unknown>)?.then).toBe("function");

    releaseGate();
    await tick();
    const rendered = renderNode(
      root.props.children as FigElement,
    ) as FigElement;
    expect(rendered.type).toBe("i");
  });

  it("treats a model referencing an unarrived client row as a protocol failure", async () => {
    const decode = decodeRows([
      model(0, element({ $fig: "client", id: 9 }, {})),
    ]);

    await expect(decode.value).rejects.toThrow(
      "Payload model referenced client row 9 before it arrived.",
    );
    expect((await decode.completion).status).toBe("failed");
  });

  it("ignores rows still queued when the decode aborts", async () => {
    const source = controlledRowStream();
    source.push(model(0, element("div", {})));
    source.close();

    // Abort synchronously, before ingestion gets to read the queued rows.
    const decode = decodePayloadStream(source.stream);
    decode.abort();

    expect(await decode.completion).toEqual({ status: "aborted" });
    await expect(decode.value).rejects.toMatchObject({
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
