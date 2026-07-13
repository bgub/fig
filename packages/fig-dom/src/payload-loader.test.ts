import {
  assets,
  createElement,
  dataResource,
  type FigNode,
  readData,
  readPromise,
  stylesheet,
  Suspense,
} from "@bgub/fig";
import { serverDataResource } from "@bgub/fig/server";
import { renderToPayloadStream } from "@bgub/fig-server/payload";
import { describe, expect, it } from "vitest";
import { createRoot, flushSync, payloadDataLoader } from "./index.ts";
import {
  deferred,
  delay,
  FakeElement,
  installFakeDocument,
} from "./test-utils.ts";

installFakeDocument();

// The generation-lifetime signal and hydrate-capability mechanics are
// unit-tested in @bgub/fig's data-store tests; these cover the web adapter:
// HTTP validation, decode wiring, and readData returning renderable trees.

function payloadResponse(
  node: FigNode,
  init: ResponseInit & { renderSignal?: AbortSignal } = {},
): Response {
  const { renderSignal, ...responseInit } = init;
  const result = renderToPayloadStream(node, { signal: renderSignal });
  return new Response(result.stream, {
    headers: { "content-type": result.contentType },
    ...responseInit,
  });
}

function loaderContext(): { signal: AbortSignal } {
  return { signal: new AbortController().signal };
}

describe("payloadDataLoader", () => {
  it("rejects non-2xx responses and cancels the body", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const load = payloadDataLoader<[]>({
      request: () => new Response(body, { status: 503 }),
    });

    await expect(load(loaderContext())).rejects.toThrow(
      "Payload request failed with status 503.",
    );
    expect(cancelled).toBe(true);
  });

  it("requires a response body", async () => {
    const load = payloadDataLoader<[]>({
      request: () => new Response(null, { status: 200 }),
    });

    await expect(load(loaderContext())).rejects.toThrow(
      "Payload response did not include a body.",
    );
  });

  it("rejects codec mismatches and cancels the body", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const load = payloadDataLoader<[]>({
      request: () =>
        new Response(body, {
          headers: {
            "content-type": "text/x-fig-payload; codec=binary",
          },
        }),
    });

    await expect(load(loaderContext())).rejects.toThrow(
      'Payload codec mismatch: producer used "binary"',
    );
    expect(cancelled).toBe(true);
  });

  it("cancels the body when the signal aborted during the request", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const controller = new AbortController();
    const load = payloadDataLoader<[]>({
      request: () => {
        controller.abort("gone");
        return new Response(body);
      },
    });

    await expect(load({ signal: controller.signal })).rejects.toBe("gone");
    expect(cancelled).toBe(true);
  });

  it("delivers decoded trees through readData and hydrates server-read data rows", async () => {
    const userResource = serverDataResource<[string], { name: string }>({
      key: (id: string) => ["loader-user", id],
      load: () => ({ name: "Grace" }),
    });
    // The client half of the same key: hydrate-only, freshened by the
    // payload's data rows — no second request.
    const clientUserResource = dataResource<[string], { name: string }>({
      key: (id: string) => ["loader-user", id],
    });
    let requests = 0;

    function ServerPost(props: { slug: string }) {
      const user = readData(userResource, "one");
      return createElement(
        "article",
        null,
        createElement("h1", null, `Post ${props.slug}`),
        createElement("p", null, `By ${user.name}`),
      );
    }

    const postResource = dataResource<[string], FigNode>({
      key: (slug: string) => ["loader-post", slug],
      load: payloadDataLoader<[string]>({
        request: (slug) => {
          requests += 1;
          return payloadResponse(createElement(ServerPost, { slug }));
        },
      }),
    });

    function Page() {
      const post = readData(postResource, "hello");
      // Data rows land before the root row decodes, so by the time the post
      // is readable the server-read entry is hydrated — read it directly.
      const user = readData(clientUserResource, "one");
      return createElement("main", null, post, `— ${user.name}`);
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    flushSync(() =>
      root.render(
        createElement(
          Suspense,
          { fallback: createElement("span", null, "Loading") },
          createElement(Page, null),
        ),
      ),
    );

    expect(container.textContent).toBe("Loading");
    await delay();

    expect(container.textContent).toBe("Post helloBy Grace— Grace");
    expect(requests).toBe(1);
  });

  it("keeps previous content visible while a refresh is pending", async () => {
    let requests = 0;
    const gate = deferred<void>();

    function ServerNote() {
      const revision = requests;
      if (revision > 1) readPromise(gate.promise);
      return createElement("p", null, `note v${revision}`);
    }

    const noteResource = dataResource<[], FigNode>({
      key: () => ["loader-note"],
      load: payloadDataLoader<[]>({
        request: () => {
          requests += 1;
          return payloadResponse(createElement(ServerNote, null));
        },
      }),
    });

    function Page() {
      return readData(noteResource);
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    flushSync(() =>
      root.render(
        createElement(
          Suspense,
          { fallback: createElement("span", null, "Loading") },
          createElement(Page, null),
        ),
      ),
    );
    await delay();
    expect(container.textContent).toBe("note v1");

    const refresh = root.data.refreshData(noteResource);
    await delay();
    // The refreshing entry keeps serving the previous tree; no fallback.
    expect(container.textContent).toBe("note v1");

    gate.resolve(undefined);
    await refresh;
    await delay();
    expect(container.textContent).toBe("note v2");
  });

  it("aborts the superseded generation's decode on refresh", async () => {
    const signals: AbortSignal[] = [];
    let requests = 0;
    const never = new Promise<string>(() => undefined);

    function ServerPost() {
      const revision = requests;
      return createElement(
        "div",
        null,
        createElement("p", null, `body v${revision}`),
        revision === 1
          ? createElement(
              Suspense,
              { fallback: "loading comments" },
              createElement(HungComments, null),
            )
          : null,
      );
    }

    function HungComments(): FigNode {
      return createElement("ul", null, readPromise(never));
    }

    const abortable = new AbortController();
    const postResource = dataResource<[], FigNode>({
      key: () => ["loader-abort"],
      load: payloadDataLoader<[]>({
        request: (context) => {
          requests += 1;
          signals.push(context.signal);
          return payloadResponse(createElement(ServerPost, null), {
            renderSignal: requests === 1 ? abortable.signal : undefined,
          });
        },
      }),
    });

    function Page() {
      return readData(postResource);
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    flushSync(() =>
      root.render(
        createElement(
          Suspense,
          { fallback: createElement("span", null, "Loading") },
          createElement(Page, null),
        ),
      ),
    );
    await delay();
    expect(container.textContent).toContain("body v1");
    expect(signals[0]?.aborted).toBe(false);

    await root.data.refreshData(postResource);
    await delay();

    // The old generation's signal aborted, ending its background decode.
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    expect(container.textContent).toBe("body v2");

    abortable.abort();
  });

  it("inserts streamed assets into the document head and gates dependent reveal", async () => {
    function StyledPost() {
      return assets(
        [stylesheet("/loader.css")],
        createElement("section", null, "styled"),
      );
    }

    const styledResource = dataResource<[], FigNode>({
      key: () => ["loader-styled"],
      load: payloadDataLoader<[]>({
        request: () => payloadResponse(createElement(StyledPost, null)),
      }),
    });

    function Page() {
      return readData(styledResource);
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    flushSync(() =>
      root.render(
        createElement(
          Suspense,
          { fallback: createElement("span", null, "Loading") },
          createElement(Page, null),
        ),
      ),
    );
    await delay();

    const head = document.head as unknown as FakeElement;
    const link = head.childNodes.find(
      (child): child is FakeElement =>
        child instanceof FakeElement &&
        child.getAttribute?.("href") === "/loader.css",
    );
    expect(link).toBeDefined();
    // The stylesheet is still loading; the dependent root row stays gated.
    expect(container.textContent).toBe("Loading");

    link?.dispatch("load");
    await delay();
    expect(container.textContent).toBe("styled");
  });

  it("replays element-valued entries buffered by the stub store", async () => {
    const snippetResource = dataResource<[], FigNode>({
      key: () => ["loader-snippet"],
    });

    function Page() {
      return readData(snippetResource);
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element, {
      initialData: [
        {
          key: ["loader-snippet"],
          value: createElement("em", null, "hydrated snippet"),
        },
      ],
    });
    flushSync(() => root.render(createElement(Page, null)));

    expect(container.textContent).toBe("hydrated snippet");
  });
});
