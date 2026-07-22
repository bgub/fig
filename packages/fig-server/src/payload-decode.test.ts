import {
  assets,
  clientReference,
  createContext,
  createElement,
  dataResource,
  type ElementType,
  type FigElement,
  type FigNode,
  isValidElement,
  readContext,
  readData,
  readPromise,
  stylesheet,
  Suspense,
  useState,
} from "@bgub/fig";
import { readThenable, setCurrentDispatcher } from "@bgub/fig/internal";
import {
  decodePayloadStream,
  type PayloadDecodeCompletion,
  type PayloadDecodeOptions,
} from "@bgub/fig/payload";
import { describe, expect, it } from "vitest";
import { renderToPayloadStream } from "./payload.ts";
import { createStaticDispatcher, deferred } from "./shared.ts";

// Render → decode round trips: the decoder's own row-level semantics are
// unit-tested in @bgub/fig (packages/fig/src/payload.test.ts); these tests
// prove real renderToPayloadStream output decodes into working trees.

function decodeRender(
  node: FigNode,
  options?: PayloadDecodeOptions & {
    render?: Parameters<typeof renderToPayloadStream>[1];
  },
) {
  const { render, ...decodeOptions } = options ?? {};
  const result = renderToPayloadStream(node, render);
  const done = deferred<PayloadDecodeCompletion>();
  return {
    decode: decodePayloadStream(result.stream, {
      ...decodeOptions,
      onStreamDone: done.resolve,
    }),
    done: done.promise,
    result,
  };
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

function evaluateNode(node: FigNode): FigNode {
  if (Array.isArray(node)) return node.map((child) => evaluateNode(child));
  if (!isValidElement(node)) return node;
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

describe("renderToPayloadStream → decodePayloadStream", () => {
  it("round-trips a tree with a streamed hole that carries cycles and shared references", async () => {
    const comments = deferred<string[]>();
    const shared: { tag: string; self?: unknown } = { tag: "shared" };
    shared.self = shared;

    // The streaming story: a server component suspends on a pending read, so
    // its subtree outlines as a lazy hole that fills when the row arrives.
    function Comments() {
      const items = readPromise(comments.promise);
      return createElement(
        "ul",
        { meta: shared },
        items.map((item) => createElement("li", { key: item }, item)),
      );
    }

    function Post() {
      return createElement(
        "article",
        { meta: shared },
        createElement("h1", null, "Title"),
        createElement(
          Suspense,
          { fallback: "loading" },
          createElement(Comments, null),
        ),
      );
    }

    const { decode, done, result } = decodeRender(createElement(Post, null));

    const root = (await decode) as FigElement;
    expect(root.type).toBe("article");
    const [heading, suspense] = root.props.children as [FigElement, FigElement];
    expect(heading.props.children).toBe("Title");
    expect(suspense.type).toBe(Suspense);

    // The hole suspends while its row is outstanding.
    let thrown: unknown;
    try {
      renderNode(suspense.props.children as FigElement);
    } catch (error) {
      thrown = error;
    }
    expect(typeof (thrown as PromiseLike<unknown>)?.then).toBe("function");

    comments.resolve(["first", "second"]);
    await result.allReady;
    expect(await done).toEqual({ status: "complete" });

    const list = renderNode(
      suspense.props.children as FigElement,
    ) as FigElement;
    expect(list.type).toBe("ul");
    expect(
      (list.props.children as FigElement[]).map((item) => item.props.children),
    ).toEqual(["first", "second"]);

    // Shared references and cycles survive across the root and the hole.
    const meta = root.props.meta as { self: unknown };
    expect(meta.self).toBe(meta);
    expect(list.props.meta).toBe(meta);
  });

  it("renders decoded client references as islands", async () => {
    const Island = clientReference<{ label: string }>({
      id: "src/Island.tsx#Island",
    });

    function Page() {
      return createElement(
        "div",
        null,
        createElement(Island, { label: "count" }),
      );
    }

    const loads: string[] = [];
    const { decode, done } = decodeRender(createElement(Page, null), {
      resolveClientReference: (reference) => {
        loads.push(reference.id);
        return Promise.resolve((props: { label: string }) =>
          createElement("button", null, `island:${props.label}`),
        );
      },
    });

    const root = (await decode) as FigElement;
    await done;
    expect(loads).toEqual(["src/Island.tsx#Island"]);

    const rendered = renderNode(root) as FigElement;
    const button = rendered.props.children as FigElement;
    expect(button.type).toBe("button");
    expect(button.props.children).toBe("island:count");
  });

  it("hydrates data read by server components through the capability", async () => {
    const userResource = dataResource<[string], { name: string }>({
      key: (id: string) => ["decode-user", id],
      load: () => ({ name: "Grace" }),
    });

    function Profile() {
      const user = readData(userResource, "one");
      return createElement("span", null, user.name);
    }

    const hydrated: unknown[] = [];
    const { decode } = decodeRender(createElement(Profile, null), {
      hydrate: (entries) => {
        hydrated.push(...entries);
        return true;
      },
    });

    const root = (await decode) as FigElement;
    expect(root.props.children).toBe("Grace");
    expect(hydrated).toEqual([
      { key: ["decode-user", "one"], value: { name: "Grace" } },
    ]);
  });

  it("round-trips request context provided at the render root", async () => {
    const SessionContext = createContext<string>("anonymous");

    function Who() {
      return createElement("span", null, readContext(SessionContext));
    }

    const { decode } = decodeRender(
      createElement(
        SessionContext,
        { value: "ada@example.com" },
        createElement(Who, null),
      ),
    );

    const root = (await decode) as FigElement;
    expect(root.props.children).toBe("ada@example.com");
  });

  it("rejects a failed hole with the onError digest while the tree stays fulfilled", async () => {
    const failure = Promise.reject(new Error("secret database details"));
    failure.catch(() => undefined);

    function Failing(): FigNode {
      readPromise(failure);
      return null;
    }

    function Page() {
      return createElement(
        "div",
        null,
        createElement(
          Suspense,
          { fallback: "loading" },
          createElement(Failing, null),
        ),
      );
    }

    const { decode, done } = decodeRender(createElement(Page, null), {
      render: { onError: () => ({ digest: "digest-7" }) },
    });

    const root = (await decode) as FigElement;
    expect(await done).toEqual({ status: "complete" });

    const suspense = root.props.children as FigElement;
    let thrown: unknown;
    try {
      renderNode(suspense.props.children as FigElement);
    } catch (error) {
      thrown = error;
    }
    expect((thrown as { digest?: string }).digest).toBe("digest-7");
    expect(String(thrown)).not.toContain("secret database details");
  });

  it("passes streamed asset rows to prepareAssets and gates the dependent reveal", async () => {
    const gate = deferred<void>();
    const prepared: unknown[] = [];

    function Styled() {
      return assets(
        [stylesheet("/styled.css", { precedence: "default" })],
        createElement("section", null, "styled content"),
      );
    }

    const { decode } = decodeRender(createElement(Styled, null), {
      prepareAssets: (list) => {
        prepared.push(...list);
        return gate.promise;
      },
    });

    let revealed = false;
    void decode.then(() => {
      revealed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(prepared).toMatchObject([
      { href: "/styled.css", kind: "stylesheet", precedence: "default" },
    ]);
    expect(revealed).toBe(false);

    gate.resolve(undefined);
    const root = (await decode) as FigElement;
    expect(root.type).toBe("section");
  });

  it("gates the outlined hole — not the enclosing tree — on assets discovered in a suspended subtree", async () => {
    const gate = deferred<void>();
    const content = deferred<string>();
    const prepared: unknown[] = [];

    function Inner(): FigNode {
      return createElement("p", null, readPromise(content.promise));
    }

    function Styled() {
      return assets([stylesheet("/hole.css")], createElement(Inner, null));
    }

    function Page() {
      return createElement(
        "div",
        null,
        createElement(
          Suspense,
          { fallback: "loading" },
          createElement(Styled, null),
        ),
      );
    }

    const { decode, done, result } = decodeRender(createElement(Page, null), {
      prepareAssets: (list) => {
        prepared.push(...list);
        return gate.promise;
      },
    });

    // The root reveals ungated, yet the assets row is already on the wire —
    // preload starts before the hole's content settles.
    const root = (await decode) as FigElement;
    expect(root.type).toBe("div");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(prepared).toMatchObject([{ href: "/hole.css", kind: "stylesheet" }]);

    content.resolve("styled");
    await result.allReady;
    // Ingestion completes while the gate is still held: gates delay reveal,
    // not arrival.
    expect(await done).toEqual({ status: "complete" });

    const suspense = root.props.children as FigElement;
    const hole = suspense.props.children as FigElement;
    let thrown: unknown;
    try {
      renderNode(hole);
    } catch (error) {
      thrown = error;
    }
    expect(typeof (thrown as PromiseLike<unknown>)?.then).toBe("function");

    gate.resolve(undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const filled = renderNode(hole) as FigElement;
    expect(filled.type).toBe("p");
    expect(filled.props.children).toBe("styled");
  });

  it("rejects unresolved holes when the decode aborts mid-stream", async () => {
    const never = deferred<string>();

    function Hung(): FigNode {
      return createElement("p", null, readPromise(never.promise));
    }

    function Page() {
      return createElement(
        "div",
        null,
        createElement(
          Suspense,
          { fallback: "loading" },
          createElement(Hung, null),
        ),
      );
    }

    const controller = new AbortController();
    const { decode, done } = decodeRender(createElement(Page, null), {
      signal: controller.signal,
    });

    const root = (await decode) as FigElement;
    controller.abort("superseded");
    expect(await done).toEqual({ status: "aborted" });

    const suspense = root.props.children as FigElement;
    let thrown: unknown;
    try {
      renderNode(suspense.props.children as FigElement);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ name: "PayloadDecodeAbortedError" });
  });

  it("dev-throws client APIs during payload render", async () => {
    function Stateful() {
      const [count] = useState(0);
      return createElement("span", null, count);
    }

    const { decode } = decodeRender(createElement(Stateful, null));

    await expect(decode).rejects.toThrow(
      "useState cannot be used during payload render: serialized components are render-only.",
    );
  });
});
