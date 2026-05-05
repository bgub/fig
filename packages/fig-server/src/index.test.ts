import {
  createContext,
  createElement,
  ErrorBoundary,
  Fragment,
  readContext,
  readPromise,
  Suspense,
  useMemo,
  useReactive,
  useState,
} from "@bgub/fig";
import { describe, expect, it } from "vitest";
import { renderToReadableStream, renderToString } from "./index.ts";
import { jsString } from "./protocol.ts";

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

interface Deferred<T> {
  promise: Promise<T>;
  reject(reason?: unknown): void;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let reject: Deferred<T>["reject"] = () => undefined;
  let resolve: Deferred<T>["resolve"] = () => undefined;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, reject, resolve };
}

async function waitForMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function readResolvedSuspenseHtml(
  identifierPrefix?: string,
): Promise<string> {
  const pending = deferred<string>();

  function Message() {
    return createElement("span", null, readPromise(pending.promise));
  }

  const result = renderToReadableStream(
    createElement(
      Suspense,
      { fallback: createElement("em", null, "Loading") },
      createElement("div", null, "Before ", createElement(Message, null)),
    ),
    identifierPrefix === undefined ? undefined : { identifierPrefix },
  );

  await result.shellReady;
  pending.resolve("Ready");
  await result.allReady;
  return readStream(result.stream);
}

describe("@bgub/fig-server", () => {
  it("renders host elements and escapes text and attributes", async () => {
    const html = await renderToString(
      createElement(
        "button",
        {
          className: "primary",
          disabled: true,
          value: '<&"',
          events: [{}],
          bind: () => undefined,
          onClick: () => undefined,
          style: {
            backgroundColor: "red",
            "--gap": "1rem",
            opacity: 0,
          },
        },
        "Save & <",
      ),
    );

    expect(html).toBe(
      '<button class="primary" disabled value="&lt;&amp;&quot;" style="background-color:red;--gap:1rem;opacity:0">Save &amp; &lt;</button>',
    );
  });

  it("renders fragments, arrays, function components, and state initializers", async () => {
    function Counter() {
      const [count] = useState(() => 3);
      const label = useMemo(() => "Count ", []);
      useReactive(() => {
        throw new Error("Server effects should not run.");
      });

      return createElement("span", null, label, count);
    }

    const html = await renderToString(
      createElement(Fragment, null, createElement("h1", null, "Fig"), [
        createElement(Counter, { key: "counter" }),
        " done",
      ]),
    );

    expect(html).toBe("<h1>Fig</h1><span>Count 3</span> done");
  });

  it("reads server context values from the nearest provider", async () => {
    const Theme = createContext("light");

    function Badge() {
      return createElement("span", null, readContext(Theme));
    }

    const html = await renderToString(
      createElement(
        "section",
        null,
        createElement(Badge, null),
        createElement(Theme, { value: "dark" }, createElement(Badge, null)),
      ),
    );

    expect(html).toBe("<section><span>light</span><span>dark</span></section>");
  });

  it("streams Suspense fallback at shell ready", async () => {
    const promise = new Promise<string>(() => undefined);

    function Message() {
      return createElement("span", null, readPromise(promise));
    }

    const result = renderToReadableStream(
      createElement(
        Suspense,
        { fallback: createElement("em", null, "Loading") },
        createElement("div", null, "Before ", createElement(Message, null)),
      ),
      { identifierPrefix: "test", nonce: "abc" },
    );

    await result.shellReady;
    result.abort("stop");
    await result.allReady;

    const html = await readStream(result.stream);

    expect(html).toContain("<!--fig:suspense:pending:0-->");
    expect(html).toContain('<template id="test-b-0"></template>');
    expect(html).toContain("<em>Loading</em>");
    expect(html).toContain('nonce="abc"');
    expect(html).toContain('__figSSR.x("test-b-0","","")');
  });

  it("streams resolved Suspense content and fills partial segments", async () => {
    const pending = deferred<string>();

    function Message() {
      return createElement("span", null, readPromise(pending.promise));
    }

    const result = renderToReadableStream(
      createElement(
        Suspense,
        { fallback: createElement("em", null, "Loading") },
        createElement("div", null, "Before ", createElement(Message, null)),
      ),
      { identifierPrefix: "test" },
    );

    await result.shellReady;
    pending.resolve("Ready");
    await result.allReady;

    const html = await readStream(result.stream);

    expect(html).toContain("<!--fig:suspense:pending:0-->");
    expect(html).toContain("<em>Loading</em>");
    expect(html).toContain(
      '<div hidden id="test-s-0"><div>Before <template id="test-p-1"></template></div></div>',
    );
    expect(html).toContain(
      '<div hidden id="test-s-1"><span>Ready</span></div>',
    );
    expect(html).toContain('__figSSR.s("test-p-1","test-s-1")');
    expect(html).toContain('__figSSR.c("test-b-0","test-s-0")');
  });

  it("keeps host markup balanced when a single child suspends", async () => {
    const pending = deferred<string>();

    function Message() {
      return readPromise(pending.promise);
    }

    const result = renderToReadableStream(
      createElement(
        Suspense,
        { fallback: createElement("em", null, "Loading") },
        createElement("div", null, createElement(Message, null)),
      ),
      { identifierPrefix: "test" },
    );

    await result.shellReady;
    pending.resolve("Ready");
    await result.allReady;

    const html = await readStream(result.stream);

    expect(html).toContain(
      '<div hidden id="test-s-0"><div><template id="test-p-1"></template></div></div>',
    );
    expect(html).toContain('<div hidden id="test-s-1">Ready</div>');
  });

  it("recovers Suspense boundaries from server errors with client render markers", async () => {
    const errors: unknown[] = [];
    const stacks: string[] = [];

    function Broken() {
      throw new Error("server failed");
    }

    const result = renderToReadableStream(
      createElement(
        Suspense,
        { fallback: createElement("em", null, "Loading") },
        createElement(Broken, null),
      ),
      {
        identifierPrefix: "test",
        onError(error, info) {
          errors.push(error);
          stacks.push(info.componentStack);
          return { digest: "digest-1", message: "Server failed" };
        },
      },
    );

    await result.allReady;
    const html = await readStream(result.stream);

    expect(errors).toHaveLength(1);
    expect(stacks[0]).toContain("at Broken");
    expect(html).toContain("<em>Loading</em>");
    expect(html).toContain('__figSSR.x("test-b-0","digest-1","Server failed")');
  });

  it("does not reveal a boundary after a later segment errors", async () => {
    const first = deferred<string>();
    const second = deferred<string>();

    function First() {
      return createElement("span", null, readPromise(first.promise));
    }

    function Second() {
      return createElement("span", null, readPromise(second.promise));
    }

    const result = renderToReadableStream(
      createElement(
        Suspense,
        { fallback: createElement("em", null, "Loading") },
        createElement(
          "div",
          null,
          createElement(First, null),
          createElement(Second, null),
        ),
      ),
      {
        identifierPrefix: "test",
        onError() {
          return { digest: "digest-2" };
        },
      },
    );

    await result.shellReady;
    first.resolve("First");
    await waitForMicrotasks();
    second.reject(new Error("second failed"));
    await result.allReady;

    const html = await readStream(result.stream);
    const clientRenderIndex = html.indexOf('__figSSR.x("test-b-0"');

    expect(html).toContain("<em>Loading</em>");
    expect(html).toContain("<span>First</span>");
    expect(clientRenderIndex).toBeGreaterThan(-1);
    expect(html).not.toContain('__figSSR.c("test-b-0"');
    expect(html.slice(clientRenderIndex)).not.toContain("__figSSR.s(");
  });

  it("renders error boundary children on the server", async () => {
    const html = await renderToString(
      createElement(
        ErrorBoundary,
        { fallback: createElement("span", null, "Crashed") },
        createElement("span", null, "Ready"),
      ),
    );

    expect(html).toBe("<span>Ready</span>");
  });

  it("does not catch server render errors with error boundaries", async () => {
    function Broken() {
      throw new Error("server failed");
    }

    await expect(
      renderToString(
        createElement(
          ErrorBoundary,
          { fallback: createElement("span", null, "Crashed") },
          createElement(Broken, null),
        ),
      ),
    ).rejects.toThrow("server failed");
  });

  it("returns a Web stream result with readiness promises", async () => {
    const result = renderToReadableStream(createElement("p", null, "Hi"));

    await expect(result.shellReady).resolves.toBeUndefined();
    await expect(result.allReady).resolves.toBeUndefined();
    expect(result.contentType).toBe("text/html; charset=utf-8");
    expect(await readStream(result.stream)).toBe("<p>Hi</p>");
  });

  it("rejects render-phase state updates", async () => {
    function Bad() {
      const [, setCount] = useState(0);
      setCount(1);
      return null;
    }

    await expect(renderToString(createElement(Bad, null))).rejects.toThrow(
      "State updates are not allowed during server render.",
    );
  });

  it("throws for invalid children and invalid host props", async () => {
    await expect(
      renderToString(createElement("div", null, { nope: true })),
    ).rejects.toThrow("Invalid Fig child: object with keys nope.");

    await expect(
      renderToString(createElement("div", { data: { nope: true } })),
    ).rejects.toThrow('Cannot serialize prop "data" to HTML.');
  });

  it("uses React-like streaming identifier prefixes", async () => {
    for (const [identifierPrefix, expectedPrefix] of [
      [undefined, ""],
      ["", ""],
      ["test", "test-"],
    ] as const) {
      const html = await readResolvedSuspenseHtml(identifierPrefix);

      expect(html).toContain(`<template id="${expectedPrefix}b-0"></template>`);
      expect(html).toContain(`<template id="${expectedPrefix}p-1"></template>`);
      expect(html).toContain(`<div hidden id="${expectedPrefix}s-0">`);
      expect(html).toContain(
        `__figSSR.s("${expectedPrefix}p-1","${expectedPrefix}s-1")`,
      );
      expect(html).toContain(
        `__figSSR.c("${expectedPrefix}b-0","${expectedPrefix}s-0")`,
      );
    }

    const hostilePrefix = 'x" onclick="<bad>&';
    const hostileHtml = await readResolvedSuspenseHtml(hostilePrefix);
    const escapedPrefix = "x&quot; onclick=&quot;&lt;bad&gt;&amp;";
    const escapedBoundaryId = `${escapedPrefix}-b-0`;
    const escapedContentSegmentId = `${escapedPrefix}-s-0`;
    const escapedPlaceholderId = `${escapedPrefix}-p-1`;
    const boundaryId = `${hostilePrefix}-b-0`;
    const contentSegmentId = `${hostilePrefix}-s-0`;
    const placeholderId = `${hostilePrefix}-p-1`;
    const partialSegmentId = `${hostilePrefix}-s-1`;

    expect(hostileHtml).toContain(
      `<template id="${escapedBoundaryId}"></template>`,
    );
    expect(hostileHtml).toContain(
      `<div hidden id="${escapedContentSegmentId}">`,
    );
    expect(hostileHtml).toContain(
      `<template id="${escapedPlaceholderId}"></template>`,
    );
    expect(hostileHtml).toContain(
      `__figSSR.s(${jsString(placeholderId)},${jsString(partialSegmentId)})`,
    );
    expect(hostileHtml).toContain(
      `__figSSR.c(${jsString(boundaryId)},${jsString(contentSegmentId)})`,
    );
  });

  it("renders void elements and rejects their children", async () => {
    await expect(
      renderToString(createElement("input", { value: "Fig" })),
    ).resolves.toBe('<input value="Fig">');

    await expect(
      renderToString(createElement("input", null, "child")),
    ).rejects.toThrow("Void element <input> cannot have children.");
  });
});
