import {
  assets,
  createElement,
  dataResource,
  type DataResourceLoadContext,
  type DataResourceLoader,
  ErrorBoundary,
  type FigNode,
  readData,
  readPromise,
  stylesheet,
  Suspense,
  title,
} from "@bgub/fig";
import { renderToPayloadStream } from "@bgub/fig-server/payload";
import { describe, expect, it } from "vitest";
import { createRoot, flushSync } from "./index.ts";
import { decodePayloadResponse } from "./payload-decoder.ts";
import {
  deferred,
  waitForHostTurns,
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

function testPayloadLoader<TArgs extends unknown[]>(options: {
  request: DataResourceLoader<TArgs, Response>;
}): DataResourceLoader<TArgs, FigNode> {
  return async (...argsAndContext) => {
    const context = argsAndContext.at(-1) as DataResourceLoadContext;
    const args = argsAndContext.slice(0, -1) as TArgs;
    const response = await options.request(...args, { signal: context.signal });
    return decodePayloadResponse(response, context);
  };
}

describe("decodePayloadResponse", () => {
  it("rejects non-2xx responses and cancels the body", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    await expect(
      decodePayloadResponse(
        new Response(body, { status: 503 }),
        loaderContext(),
      ),
    ).rejects.toThrow("Payload request failed with status 503.");
    expect(cancelled).toBe(true);
  });

  it("requires a response body", async () => {
    await expect(
      decodePayloadResponse(new Response(null), loaderContext()),
    ).rejects.toThrow("Payload response did not include a body.");
  });

  it("rejects codec mismatches and cancels the body", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    await expect(
      decodePayloadResponse(
        new Response(body, {
          headers: {
            "content-type": "text/x-fig-payload; codec=binary",
          },
        }),
        loaderContext(),
      ),
    ).rejects.toThrow('Payload codec mismatch: producer used "binary"');
    expect(cancelled).toBe(true);
  });

  it("cancels the body when the load signal is already aborted", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const controller = new AbortController();
    controller.abort("gone");

    await expect(
      decodePayloadResponse(new Response(body), {
        signal: controller.signal,
      }),
    ).rejects.toBe("gone");
    expect(cancelled).toBe(true);
  });

  it("delivers decoded trees through readData and hydrates server-read data rows", async () => {
    const userResource = dataResource<[string], { name: string }>({
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
      load: testPayloadLoader<[string]>({
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
    await waitForHostTurns();

    expect(container.textContent).toBe("Post helloBy Grace— Grace");
    expect(requests).toBe(1);
  });

  it("keeps previous content visible while a refresh is pending", async () => {
    let requests = 0;
    const gate = deferred<void>();

    function ServerNote() {
      const revision = requests;
      if (revision > 1) readPromise(gate.promise);
      return assets(
        title(`Note v${revision}`),
        createElement("p", null, `note v${revision}`),
      );
    }

    const noteResource = dataResource<[], FigNode>({
      key: () => ["loader-note"],
      load: testPayloadLoader<[]>({
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
    await waitForHostTurns();
    expect(container.textContent).toBe("note v1");
    expect((document.head as unknown as FakeElement).textContent).toBe(
      "Note v1",
    );

    const refresh = root.data.refreshData(noteResource);
    await waitForHostTurns();
    // The refreshing entry keeps serving the previous tree; no fallback.
    expect(container.textContent).toBe("note v1");
    expect((document.head as unknown as FakeElement).textContent).toBe(
      "Note v1",
    );

    gate.resolve(undefined);
    await refresh;
    await waitForHostTurns();
    expect(container.textContent).toBe("note v2");
    expect((document.head as unknown as FakeElement).textContent).toBe(
      "Note v2",
    );
  });

  it("attributes rejected payload holes to their fulfilled owner entry", async () => {
    const hole = deferred<string>();
    let requests = 0;
    let caughtError: unknown;
    let caughtKeys: unknown;

    function Comments() {
      return createElement("span", null, readPromise(hole.promise));
    }

    const pageResource = dataResource<[], FigNode>({
      key: () => ["payload-page"],
      load: testPayloadLoader<[]>({
        request: () => {
          requests += 1;
          return requests === 1
            ? payloadResponse(
                createElement(
                  "main",
                  null,
                  createElement(
                    Suspense,
                    { fallback: createElement("i", null, "hole pending") },
                    createElement(Comments, null),
                  ),
                ),
              )
            : payloadResponse(createElement("main", null, "recovered"));
        },
      }),
    });

    function Page() {
      return readData(pageResource);
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    const renderPage = (key: string) =>
      root.render(
        createElement(
          ErrorBoundary,
          {
            fallback: (error, info) => {
              caughtError = error;
              caughtKeys = info.dataResourceKeys;
              return createElement("p", null, "hole failed");
            },
            key,
          },
          createElement(
            Suspense,
            { fallback: createElement("span", null, "page pending") },
            createElement(Page, null),
          ),
        ),
      );
    flushSync(() => renderPage("initial"));
    await waitForHostTurns();
    expect(container.textContent).toContain("hole pending");

    hole.reject(new Error("comments failed"));
    await waitForHostTurns();

    expect(container.textContent).toBe("hole failed");
    expect(caughtKeys).toEqual([["payload-page"]]);
    expect(root.data.invalidateDataError(caughtError)).toBe(true);
    flushSync(() => renderPage("retry"));
    await waitForHostTurns();
    expect(requests).toBe(2);
    expect(container.textContent).toBe("recovered");
  });

  it("retires the broken value when the hole error row shares a chunk with the root", async () => {
    // A server component that throws synchronously emits its hole's error
    // row in the same flush as the root row, so attribution fires before the
    // loader's returned promise settles — it must still survive publish and
    // retire the broken value on invalidation.
    let requests = 0;
    let caughtError: unknown;
    let caughtKeys: unknown;

    function Comments(): FigNode {
      throw new Error("comments failed synchronously");
    }

    const pageResource = dataResource<[], FigNode>({
      key: () => ["sync-hole-page"],
      load: testPayloadLoader<[]>({
        request: () => {
          requests += 1;
          return requests === 1
            ? payloadResponse(
                createElement(
                  "main",
                  null,
                  createElement(
                    Suspense,
                    { fallback: createElement("i", null, "hole pending") },
                    createElement(Comments, null),
                  ),
                ),
              )
            : payloadResponse(createElement("main", null, "recovered"));
        },
      }),
    });

    function Page() {
      return readData(pageResource);
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    const renderPage = (key: string) =>
      root.render(
        createElement(
          ErrorBoundary,
          {
            fallback: (error, info) => {
              caughtError = error;
              caughtKeys = info.dataResourceKeys;
              return createElement("p", null, "hole failed");
            },
            key,
          },
          createElement(
            Suspense,
            { fallback: createElement("span", null, "page pending") },
            createElement(Page, null),
          ),
        ),
      );
    flushSync(() => renderPage("initial"));
    await waitForHostTurns();

    expect(container.textContent).toBe("hole failed");
    expect(caughtKeys).toEqual([["sync-hole-page"]]);
    expect(root.data.invalidateDataError(caughtError)).toBe(true);
    flushSync(() => renderPage("retry"));
    await waitForHostTurns();
    expect(requests).toBe(2);
    expect(container.textContent).toBe("recovered");
  });

  it("refreshing while holes stream neither errors nor kills the visible tree", async () => {
    // The demo-payload regression: click refresh while comments are still
    // streaming. The visible generation keeps its authority (and its live
    // holes) until the successor's value publishes, so no abort rejection
    // ever reaches the page's ErrorBoundary.
    let requests = 0;
    const gates = [deferred<string>(), deferred<string>()];
    const secondResponse = deferred<void>();

    function Comments(props: { revision: number }): FigNode {
      return createElement(
        "ul",
        null,
        readPromise(gates[props.revision - 1]?.promise ?? Promise.resolve("")),
      );
    }

    function ServerPost(props: { revision: number }): FigNode {
      return createElement(
        "div",
        null,
        createElement("p", null, `body v${props.revision}`),
        createElement(
          Suspense,
          { fallback: createElement("i", null, "comments pending") },
          createElement(Comments, { revision: props.revision }),
        ),
      );
    }

    const postResource = dataResource<[], FigNode>({
      key: () => ["loader-streaming-refresh"],
      load: testPayloadLoader<[]>({
        request: async () => {
          requests += 1;
          const revision = requests;
          // Hold the refresh's response so the mid-refresh window is
          // observable: the visible tree must stay alive throughout it.
          if (revision === 2) await secondResponse.promise;
          return payloadResponse(createElement(ServerPost, { revision }));
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
          ErrorBoundary,
          {
            fallback: createElement("p", { "data-refresh-error": "" }, "boom"),
          },
          createElement(
            Suspense,
            { fallback: createElement("span", null, "Loading") },
            createElement(Page, null),
          ),
        ),
      ),
    );
    await waitForHostTurns();
    expect(container.textContent).toContain("body v1");
    expect(container.textContent).toContain("comments pending");

    // Refresh while the comments hole is still streaming.
    const refresh = root.data.refreshData(postResource);
    await waitForHostTurns();
    expect(container.textContent).not.toContain("boom");
    expect(container.textContent).toContain("body v1");

    // The superseded-but-still-authoritative generation keeps streaming:
    // its hole fills into the visible stale tree during the refresh window.
    gates[0]?.resolve("first comments");
    await waitForHostTurns();
    expect(container.textContent).toContain("first comments");
    expect(container.textContent).not.toContain("boom");

    // The successor publishes; the old generation retires silently.
    secondResponse.resolve(undefined);
    gates[1]?.resolve("second comments");
    await refresh;
    await waitForHostTurns();
    expect(container.textContent).toContain("body v2");
    expect(container.textContent).toContain("second comments");
    expect(container.textContent).not.toContain("boom");
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
      load: testPayloadLoader<[]>({
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
    await waitForHostTurns();
    expect(container.textContent).toContain("body v1");
    expect(signals[0]?.aborted).toBe(false);

    await root.data.refreshData(postResource);
    await waitForHostTurns();

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
      load: testPayloadLoader<[]>({
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
    await waitForHostTurns();

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
    await waitForHostTurns();
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
