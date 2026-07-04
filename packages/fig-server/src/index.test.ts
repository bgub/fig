import {
  createContext,
  createElement,
  clientReference,
  ErrorBoundary,
  type FigNode,
  Fragment,
  lazy,
  readContext,
  readPromise,
  font,
  meta,
  preload,
  preconnect,
  assets,
  script,
  stylesheet,
  Suspense,
  title,
  useExternalStore,
  useId,
  useLaggedValue,
  useMemo,
  useReactive,
  Activity,
  useStableEvent,
  useState,
  useTransition,
} from "@bgub/fig";
import { describe, expect, it } from "vite-plus/test";
import {
  renderDocumentToString,
  renderToDocumentStream,
  renderToReadableStream,
  renderToString,
} from "./index.ts";
import { jsString } from "./protocol.ts";
import { deferred } from "./shared.ts";
import { readStream } from "./test-utils.ts";

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
          "aria-label": "Save",
          class: "primary",
          "data-id": "save",
          disabled: true,
          tabindex: 0,
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
      '<button aria-label="Save" class="primary" data-id="save" disabled tabindex="0" value="&lt;&amp;&quot;" style="background-color:red;--gap:1rem;opacity:0">Save &amp; &lt;</button>',
    );
  });

  it("renders unsafe HTML without escaping it", async () => {
    const html = await renderToString(
      createElement("article", {
        class: "content",
        unsafeHTML: "<strong>Fig</strong>&",
      }),
    );

    expect(html).toBe(
      '<article class="content"><strong>Fig</strong>&</article>',
    );
  });

  it("serializes namespaced SVG attribute aliases", async () => {
    const html = await renderToString(
      createElement(
        "svg",
        null,
        createElement("use", { "xlink:href": "#icon" }),
      ),
    );

    expect(html).toBe('<svg><use xlink:href="#icon"></use></svg>');
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

  it("reads external store server snapshots", async () => {
    function App() {
      const snapshot = useExternalStore(
        () => () => undefined,
        () => "Client",
        () => "Server",
      );
      return createElement("span", null, snapshot);
    }

    await expect(renderToString(createElement(App, null))).resolves.toBe(
      "<span>Server</span>",
    );
  });

  it("returns stable events that throw if called during server render", async () => {
    let emit: (() => void) | null = null;

    function App() {
      emit = useStableEvent((_signal: AbortSignal) => undefined);
      return createElement("span", null, "Server");
    }

    await expect(renderToString(createElement(App, null))).resolves.toBe(
      "<span>Server</span>",
    );
    expect(() => emit?.()).toThrow(
      "Stable events cannot be called during server render.",
    );
  });

  it("streams hidden Activity content inside an inert template", async () => {
    const html = await renderToString(
      createElement(
        "main",
        null,
        createElement(
          Activity,
          { mode: "hidden" },
          "secret ",
          createElement("span", null, "Hidden"),
        ),
        createElement(
          Activity,
          { mode: "visible" },
          createElement("span", null, "Visible"),
        ),
      ),
    );

    // Bare text and elements alike stay invisible until hydration.
    expect(html).toBe(
      '<main><template data-fig-activity="" id="a-0">secret <span>Hidden</span></template><span>Visible</span></main>',
    );
  });

  it("renders current lagged values on the server", async () => {
    function App() {
      const value = useLaggedValue("Server", "Initial");
      return createElement("span", null, value);
    }

    await expect(renderToString(createElement(App, null))).resolves.toBe(
      "<span>Server</span>",
    );
  });

  it("renders stable prefixed ids", async () => {
    function Field({ label }: { label: string }) {
      const id = useId();

      return createElement(
        "label",
        { for: id },
        label,
        createElement("input", { id }),
      );
    }

    const html = await renderToString(
      createElement(
        "main",
        null,
        createElement(Field, { label: "First" }),
        createElement(Field, { label: "Second" }),
      ),
      { identifierPrefix: "srv-" },
    );

    expect(html).toBe(
      '<main><label for="srv-fig-0-0-0">First<input id="srv-fig-0-0-0"></label><label for="srv-fig-0-1-0">Second<input id="srv-fig-0-1-0"></label></main>',
    );
  });

  it("runs server transition callbacks without pending state", async () => {
    function App() {
      const [isPending, startTransition] = useTransition();
      let value = "Initial";
      startTransition(() => {
        value = "Updated";
      });

      return createElement(
        "span",
        null,
        isPending ? "Pending" : "Idle",
        ":",
        value,
      );
    }

    await expect(renderToString(createElement(App, null))).resolves.toBe(
      "<span>Idle:Updated</span>",
    );
  });

  it("throws when external stores omit server snapshots", async () => {
    function App() {
      const snapshot = useExternalStore(
        () => () => undefined,
        () => "Client",
      );
      return createElement("span", null, snapshot);
    }

    await expect(renderToString(createElement(App, null))).rejects.toThrow(
      "useExternalStore requires getServerSnapshot during server render.",
    );
  });

  it("rejects invalid DOM nesting during server render", async () => {
    await expect(
      renderToString(
        createElement("div", null, createElement("td", null, "Cell")),
      ),
    ).rejects.toThrow("Invalid DOM nesting: <td> cannot be a child of <div>.");
  });

  it("rejects invalid text nesting during server render", async () => {
    await expect(
      renderToString(createElement("table", null, "Text")),
    ).rejects.toThrow(
      "Invalid DOM nesting: text cannot be a child of <table>.",
    );
  });

  it("renders text children inside select elements", async () => {
    const html = await renderToString(
      createElement(
        "select",
        null,
        "Choose:",
        createElement("option", null, "Apple"),
      ),
    );

    expect(html).toBe("<select>Choose:<option>Apple</option></select>");
  });

  it("renders tables with whitespace-only text children", async () => {
    const html = await renderToString(
      createElement(
        "table",
        null,
        " ",
        createElement(
          "tbody",
          null,
          createElement("tr", null, createElement("td", null, "Cell")),
        ),
      ),
    );

    expect(html).toBe("<table> <tbody><tr><td>Cell</td></tr></tbody></table>");
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

  it("hoists explicit document assets during server render", async () => {
    const result = renderToReadableStream(
      createElement(
        "main",
        null,
        assets(
          [
            title("Fig & assets"),
            meta({ name: "description", content: "Fast < UI" }),
            preconnect("https://cdn.example.com", { crossOrigin: "anonymous" }),
            preload("/hero.png", "image", { fetchPriority: "high" }),
            font("/font.woff2", "font/woff2"),
            stylesheet("/app.css", { precedence: "app" }),
            stylesheet("/app.css", { precedence: "app" }),
            script("/app.js", { module: true }),
          ],
          createElement("h1", null, "Ready"),
        ),
      ),
      { nonce: "abc" },
    );

    await result.headReady;
    expect(result.getHead()).toBe(
      '<title>Fig &amp; assets</title><meta name="description" content="Fast &lt; UI">',
    );

    const html = await readStream(result.stream);

    expect(html).toBe(
      '<link rel="preconnect" href="https://cdn.example.com" crossorigin="anonymous" nonce="abc"><link rel="preload" href="/hero.png" as="image" fetchpriority="high" nonce="abc"><link rel="preload" href="/font.woff2" as="font" type="font/woff2" crossorigin="anonymous" nonce="abc"><link rel="stylesheet" href="/app.css" data-precedence="app" id="r-0" nonce="abc"><script src="/app.js" type="module" async nonce="abc"></script><main><h1>Ready</h1></main>',
    );
  });

  it("does not emit head-only assets into the body stream", async () => {
    const html = await renderToString(
      assets(
        [title("Head only"), meta({ name: "robots", content: "noindex" })],
        createElement("main", null, "Ready"),
      ),
    );

    expect(html).toBe("<main>Ready</main>");
  });

  it("renders full documents with collected head assets", async () => {
    function Page() {
      return createElement(
        "html",
        { lang: "en" },
        createElement(
          "head",
          null,
          createElement("meta", { charset: "utf-8" }),
        ),
        createElement(
          "body",
          null,
          assets(
            [
              title("Document"),
              meta({ name: "description", content: "SSR" }),
              stylesheet("/app.css", { precedence: "app" }),
            ],
            createElement("main", null, "Ready"),
          ),
        ),
      );
    }

    await expect(
      renderDocumentToString(createElement(Page, null)),
    ).resolves.toBe(
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Document</title><meta name="description" content="SSR"><link rel="stylesheet" href="/app.css" data-precedence="app" id="r-0"></head><body><main>Ready</main></body></html>',
    );
  });

  it("lowers host document resource tags into the resource registry", async () => {
    function Page() {
      return createElement(
        "html",
        null,
        createElement(
          "head",
          null,
          createElement("meta", { charset: "utf-8" }),
        ),
        createElement(
          "body",
          null,
          createElement("title", null, "Host Tags"),
          createElement("meta", { name: "description", content: "Host" }),
          createElement("link", {
            href: "/host.css",
            precedence: "app",
            rel: "stylesheet",
          }),
          createElement("script", {
            src: "/host.js",
            type: "module",
          }),
          createElement("main", null, "Ready"),
        ),
      );
    }

    await expect(
      renderDocumentToString(createElement(Page, null)),
    ).resolves.toBe(
      '<!doctype html><html><head><meta charset="utf-8"><title>Host Tags</title><meta name="description" content="Host"><link rel="stylesheet" href="/host.css" data-precedence="app" id="r-0"><script src="/host.js" type="module" async></script></head><body><main>Ready</main></body></html>',
    );
  });

  it("streams document bodies while injecting head assets once", async () => {
    const pending = deferred<string>();

    function Message() {
      return assets(
        stylesheet("/message.css"),
        createElement("span", null, readPromise(pending.promise)),
      );
    }

    const result = renderToDocumentStream(
      createElement(
        "html",
        null,
        createElement("head", null),
        createElement(
          "body",
          null,
          assets(
            title("Stream"),
            createElement(
              Suspense,
              { fallback: createElement("em", null, "Loading") },
              createElement(Message, null),
            ),
          ),
        ),
      ),
      { identifierPrefix: "doc" },
    );

    await result.shellReady;
    pending.resolve("Ready");
    await result.allReady;

    const html = await readStream(result.stream);
    expect(html).toContain(
      "<!doctype html><html><head><title>Stream</title></head><body>",
    );
    expect(html).toContain("<em>Loading</em>");
    expect(html).toContain(
      '<link rel="stylesheet" href="/message.css" id="doc-r-0">',
    );
    expect(html).toContain(
      '__figSSR.r(["doc-r-0"],()=>{__figSSR.c("doc-b-0","doc-s-0")})',
    );
    expect(html.indexOf("<title>Stream</title>")).toBe(
      html.lastIndexOf("<title>Stream</title>"),
    );
  });

  it("rejects document streams without an html head shell", async () => {
    await expect(
      renderDocumentToString(createElement("main", null, "Ready")),
    ).rejects.toThrow(
      "renderToDocumentStream requires the root to render an <html> document with a <head>.",
    );
  });

  it("keeps late document metadata out of an already-flushed document head", async () => {
    const pending = deferred<string>();
    const diagnostics: string[] = [];

    function Message() {
      return assets(
        title(`Late ${readPromise(pending.promise)}`),
        createElement("span", null, "Ready"),
      );
    }

    const result = renderToDocumentStream(
      createElement(
        "html",
        null,
        createElement("head", null),
        createElement(
          "body",
          null,
          createElement(
            Suspense,
            { fallback: createElement("em", null, "Loading") },
            createElement(Message, null),
          ),
        ),
      ),
      {
        onAssetError(_error, info) {
          diagnostics.push(info.key);
        },
      },
    );

    await result.shellReady;
    pending.resolve("Title");
    await result.allReady;

    const html = await readStream(result.stream);
    expect(html).toContain("<head></head>");
    expect(html).not.toContain("<title>Late Title</title>");
    expect(diagnostics).toEqual(["title"]);
  });

  it("reports late head assets while keeping them out of the stream", async () => {
    const pending = deferred<string>();
    const diagnostics: Array<{ componentStack: string; key: string }> = [];

    function Message() {
      const value = readPromise(pending.promise);
      return assets(title(`Late ${value}`), createElement("span", null, value));
    }

    const result = renderToReadableStream(
      createElement(
        Suspense,
        { fallback: createElement("em", null, "Loading") },
        createElement(Message, null),
      ),
      {
        onAssetError(error, info) {
          expect(error).toBeInstanceOf(Error);
          diagnostics.push({
            componentStack: info.componentStack,
            key: info.key,
          });
        },
      },
    );

    await result.headReady;
    expect(result.getHead()).toBe("");

    pending.resolve("Ready");
    await result.allReady;
    expect(result.getHead()).toBe("");
    expect(diagnostics).toEqual([
      {
        componentStack: "\n    at Message",
        key: "title",
      },
    ]);

    const html = await readStream(result.stream);
    expect(html).toContain("<em>Loading</em>");
    expect(html).not.toContain("<title>");
  });

  it("rejects conflicting duplicate document assets", async () => {
    await expect(
      renderToString(
        assets(
          [stylesheet("/app.css"), stylesheet("/app.css", { media: "print" })],
          createElement("main", null, "Ready"),
        ),
      ),
    ).rejects.toThrow(
      'Conflicting Fig resource for key "stylesheet:/app.css".',
    );
  });

  it("renders a fallback for client references when configured", async () => {
    const Island = clientReference({
      id: "app/Island.tsx#Island",
      load: () => Promise.resolve({}),
    });

    const html = await renderToString(
      createElement("section", null, "Before", createElement(Island, {})),
      {
        clientReferenceFallback: (reference) =>
          createElement("template", {
            "data-client-reference": reference.id,
          }),
      },
    );

    expect(html).toContain("Before");
    expect(html).toContain(
      '<template data-client-reference="app/Island.tsx#Island"></template>',
    );
  });

  it("gates streamed Suspense reveals on hoisted stylesheets", async () => {
    const pending = deferred<string>();

    function Text() {
      return createElement("span", null, readPromise(pending.promise));
    }

    function Message() {
      return assets(stylesheet("/message.css"), createElement(Text, null));
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
      '<link rel="stylesheet" href="/message.css" id="test-r-0">',
    );
    expect(html).toContain(
      '__figSSR.r(["test-r-0"],()=>{__figSSR.c("test-b-0","test-s-0")})',
    );
  });

  it("discovers assets from resolved component module ids", async () => {
    function Card() {
      return createElement("section", null, "Card");
    }

    const result = renderToReadableStream(createElement(Card, null), {
      resolveAssetKey: (type) => (type === Card ? "app/card.tsx" : undefined),
      assets: {
        "app/card.tsx": [
          title("Card"),
          stylesheet("/card.css", { blocking: "none" }),
        ],
      },
    });

    await result.headReady;
    expect(result.getHead()).toBe("<title>Card</title>");

    const html = await readStream(result.stream);
    expect(html).toBe(
      '<link rel="stylesheet" href="/card.css"><section>Card</section>',
    );
  });

  it("gates Suspense reveals on manifest-discovered stylesheets", async () => {
    const pending = deferred<string>();

    function Message() {
      return createElement("span", null, readPromise(pending.promise));
    }

    const result = renderToReadableStream(
      createElement(
        Suspense,
        { fallback: createElement("em", null, "Loading") },
        createElement(Message, null),
      ),
      {
        identifierPrefix: "manifest",
        resolveAssetKey: (type) =>
          type === Message ? "app/message.tsx" : undefined,
        assets: { "app/message.tsx": stylesheet("/message.css") },
      },
    );

    await result.shellReady;
    pending.resolve("Ready");
    await result.allReady;

    const html = await readStream(result.stream);
    expect(html).toContain(
      '<link rel="stylesheet" href="/message.css" id="manifest-r-0">',
    );
    expect(html).toContain(
      '__figSSR.r(["manifest-r-0"],()=>{__figSSR.c("manifest-b-0","manifest-s-0")})',
    );
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

  it("streams lazy components through Suspense", async () => {
    function Message() {
      return createElement("span", null, "Loaded");
    }

    const pending = deferred<typeof Message>();
    const LazyMessage = lazy(() => pending.promise);
    const result = renderToReadableStream(
      createElement(
        Suspense,
        { fallback: createElement("em", null, "Loading") },
        createElement(LazyMessage, null),
      ),
      { identifierPrefix: "lazy" },
    );

    await result.shellReady;
    pending.resolve(Message);
    await result.allReady;

    const html = await readStream(result.stream);

    expect(html).toContain("<em>Loading</em>");
    expect(html).toContain(
      '<div hidden id="lazy-s-0"><template id="lazy-p-1"></template></div>',
    );
    expect(html).toContain(
      '<div hidden id="lazy-s-1"><span>Loaded</span></div>',
    );
    expect(html).toContain('__figSSR.s("lazy-p-1","lazy-s-1")');
    expect(html).toContain('__figSSR.c("lazy-b-0","lazy-s-0")');
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

  it("emits inline scripts without top-level lexical declarations", async () => {
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
        Fragment,
        null,
        createElement(
          Suspense,
          { fallback: createElement("em", null, "One") },
          createElement(First, null),
        ),
        createElement(
          Suspense,
          { fallback: createElement("em", null, "Two") },
          createElement(Second, null),
        ),
      ),
      { identifierPrefix: "test" },
    );

    await result.shellReady;
    first.resolve("First");
    second.resolve("Second");
    await result.allReady;

    const html = await readStream(result.stream);
    const scripts = [...html.matchAll(/<script[^>]*>(.*?)<\/script>/gs)].map(
      (match) => match[1],
    );

    // Classic scripts share the page's global lexical environment: a
    // top-level let/const/class in one reveal script redeclares in the next
    // and throws, so every script after the first would be dead in browsers.
    expect(scripts.length).toBeGreaterThanOrEqual(3);
    for (const code of scripts) {
      expect(code).not.toMatch(/^\s*(?:let|const|class)\s/);
    }
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

    function Broken(): never {
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

  it("reveals a completed boundary while a sibling boundary client-renders", async () => {
    const ok = deferred<string>();
    const bad = deferred<string>();

    function Ok() {
      return createElement("span", null, readPromise(ok.promise));
    }

    function Bad() {
      return createElement("span", null, readPromise(bad.promise));
    }

    const result = renderToReadableStream(
      createElement(
        "main",
        null,
        createElement(
          Suspense,
          { fallback: createElement("em", null, "L0") },
          createElement(Ok, null),
        ),
        createElement(
          Suspense,
          { fallback: createElement("em", null, "L1") },
          createElement(Bad, null),
        ),
      ),
      {
        identifierPrefix: "test",
        onError() {
          return { digest: "d" };
        },
      },
    );

    await result.shellReady;
    ok.resolve("OK");
    await waitForMicrotasks();
    bad.reject(new Error("bad failed"));
    await result.allReady;

    const html = await readStream(result.stream);

    // The healthy boundary reveals (its content streams in a partial segment
    // that fills the boundary placeholder); the failed sibling client-renders.
    // The two boundary ids must not cross-contaminate.
    expect(html).toContain("<span>OK</span>");
    expect(html).toContain('__figSSR.c("test-b-0","test-s-0")');
    expect(html).toContain('__figSSR.x("test-b-1","d","")');
    expect(html).not.toContain('__figSSR.c("test-b-1"');
    expect(html).not.toContain('__figSSR.x("test-b-0"');
  });

  it("streams Suspense completion into a hidden Activity template instead of client-rendering", async () => {
    const pending = deferred<string>();

    function Message() {
      return createElement("span", null, readPromise(pending.promise));
    }

    const result = renderToReadableStream(
      createElement(
        Activity,
        { mode: "hidden" },
        createElement(
          Suspense,
          { fallback: createElement("em", null, "Loading") },
          createElement("div", null, "Before ", createElement(Message, null)),
        ),
      ),
      { identifierPrefix: "test" },
    );

    await result.shellReady;
    pending.resolve("Ready");
    await result.allReady;

    const html = await readStream(result.stream);

    // The hidden Activity template carries an id and holds the pending boundary.
    expect(html).toContain('<template data-fig-activity="" id="test-a-0">');
    expect(html).toContain("<!--fig:suspense:pending:0-->");
    expect(html).toContain("<em>Loading</em>");
    // The completion is revealed into the activity template content via `ac` —
    // not a client render (`x`) as the old degradation did.
    expect(html).toContain("<span>Ready</span>");
    expect(html).toMatch(/__figSSR\.ac\("test-a-0",/);
    expect(html).not.toContain("__figSSR.x(");
    expect(html).not.toContain("is client-rendered after reveal");
  });

  it("marks failed Suspense inside hidden Activity with an Activity-aware client render script", async () => {
    const pending = deferred<string>();

    function Message() {
      return createElement("span", null, readPromise(pending.promise));
    }

    const result = renderToReadableStream(
      createElement(
        Activity,
        { mode: "hidden" },
        createElement(
          Suspense,
          { fallback: createElement("em", null, "Loading") },
          createElement(Message, null),
        ),
      ),
      {
        identifierPrefix: "test",
        onError() {
          return { digest: "hidden-digest" };
        },
      },
    );

    await result.shellReady;
    pending.reject(new Error("Hidden failed"));
    await result.allReady;

    const html = await readStream(result.stream);

    expect(html).toContain('<template data-fig-activity="" id="test-a-0">');
    expect(html).toContain("<!--fig:suspense:pending:0-->");
    expect(html).toContain(
      '__figSSR.ax("test-a-0","test-b-0","hidden-digest","")',
    );
    expect(html).not.toContain('__figSSR.x("test-b-0"');
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
    function Broken(): never {
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
      renderToString(
        createElement("div", null, { nope: true } as unknown as FigNode),
      ),
    ).rejects.toThrow("Invalid Fig child: object with keys nope.");

    await expect(
      renderToString(createElement("div", { data: { nope: true } })),
    ).rejects.toThrow('Cannot serialize prop "data" to HTML.');

    await expect(
      renderToString(
        createElement("div", { unsafeHTML: "<strong>Fig</strong>" }, "Fig"),
      ),
    ).rejects.toThrow(
      "Host elements cannot have both unsafeHTML and children.",
    );

    await expect(
      renderToString(createElement("div", { unsafeHTML: { html: "" } })),
    ).rejects.toThrow(
      "The unsafeHTML prop must be a string during server render.",
    );
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
      renderToString(createElement("input", { value: true })),
    ).resolves.toBe('<input value="true">');

    await expect(
      renderToString(createElement("input", { defaultValue: true })),
    ).resolves.toBe('<input value="true">');

    await expect(
      renderToString(createElement("input", null, "child")),
    ).rejects.toThrow("Void element <input> cannot have children.");

    await expect(
      renderToString(createElement("input", { unsafeHTML: "child" })),
    ).rejects.toThrow("Void element <input> cannot have unsafeHTML.");
  });

  it("serializes form default props as browser HTML", async () => {
    const html = await renderToString(
      createElement(
        "form",
        null,
        createElement("input", { defaultValue: "Draft" }),
        createElement("input", { defaultChecked: true, type: "checkbox" }),
        createElement("textarea", { defaultValue: "Hello <Fig>" }),
        createElement(
          "select",
          { defaultValue: "b" },
          createElement("option", { value: "a" }, "A"),
          createElement("option", { value: "b" }, "B"),
        ),
        createElement(
          "select",
          { multiple: true, value: ["a", "c"] },
          createElement("option", { value: "a" }, "A"),
          createElement("option", { value: "b" }, "B"),
          createElement("option", { value: "c" }, "C"),
        ),
        createElement(
          "select",
          { defaultValue: true },
          createElement("option", { value: true }, "True"),
        ),
      ),
    );

    expect(html).toBe(
      '<form><input value="Draft"><input checked type="checkbox"><textarea>Hello &lt;Fig&gt;</textarea><select><option value="a">A</option><option value="b" selected>B</option></select><select multiple><option value="a" selected>A</option><option value="b">B</option><option value="c" selected>C</option></select><select><option value="true" selected>True</option></select></form>',
    );
  });
});
