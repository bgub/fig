import { createElement, readPromise, stylesheet, Suspense } from "@bgub/fig";
import { describe, expect, it } from "vite-plus/test";
import {
  batchedUpdates,
  createRoot,
  flushSync,
  insertAssetResources,
} from "./index.ts";
import {
  deferred,
  delay,
  FakeElement,
  installFakeDocument,
} from "./test-utils.ts";

installFakeDocument();

describe("@bgub/fig-dom", () => {
  it("renders and updates host elements", async () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    root.render(createElement("div", { class: "box", id: "first" }, "Hello"));
    await delay();

    expect(container.textContent).toBe("Hello");
    expect(container.childNodes).toHaveLength(1);
    expect((container.childNodes[0] as FakeElement).attributes).toEqual({
      class: "box",
      id: "first",
    });

    root.render(createElement("div", { id: "second" }, "Goodbye"));
    await delay();

    expect(container.textContent).toBe("Goodbye");
    expect(container.childNodes).toHaveLength(1);
    expect((container.childNodes[0] as FakeElement).attributes).toEqual({
      id: "second",
    });
  });

  it("supports root unmounts", async () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    root.render(createElement("main", null, "Mounted"));
    await delay();
    expect(container.textContent).toBe("Mounted");

    root.unmount();
    await delay();
    expect(container.textContent).toBe("");
  });

  it("flushes sync work before returning", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement("main", null, "Now")));

    expect(container.textContent).toBe("Now");
  });

  it("flushes batched root work inside flushSync", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement("main", null, "Before")));

    batchedUpdates(() => {
      root.render(createElement("main", null, "After"));
      expect(container.textContent).toBe("Before");

      flushSync(() => undefined);

      expect(container.textContent).toBe("After");
    });
  });

  it("creates SVG, MathML, and foreignObject elements in the right namespace", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement(
          "svg",
          null,
          createElement("circle", null),
          createElement("foreignObject", null, createElement("div", null)),
          createElement("svg", null),
        ),
      ),
    );

    const svg = container.childNodes[0] as FakeElement;
    const circle = svg.childNodes[0] as FakeElement;
    const foreignObject = svg.childNodes[1] as FakeElement;
    const div = foreignObject.childNodes[0] as FakeElement;
    const nestedSvg = svg.childNodes[2] as FakeElement;

    expect(svg.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(circle.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(foreignObject.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(div.namespaceURI).toBe("http://www.w3.org/1999/xhtml");
    expect(nestedSvg.namespaceURI).toBe("http://www.w3.org/2000/svg");

    flushSync(() =>
      root.render(createElement("math", null, createElement("mi", null, "x"))),
    );

    const math = container.childNodes[0] as FakeElement;
    const mi = math.childNodes[0] as FakeElement;
    expect(math.namespaceURI).toBe("http://www.w3.org/1998/Math/MathML");
    expect(mi.namespaceURI).toBe("http://www.w3.org/1998/Math/MathML");
  });

  it("adopts document resources into head without duplicating server tags", () => {
    const { container, head, root } = documentResourceRoot();
    const existing = new FakeElement("link");
    existing.setAttribute("rel", "stylesheet");
    existing.setAttribute("href", "/app.css");
    head.appendChild(existing);

    flushSync(() =>
      root.render(
        createElement(
          "main",
          null,
          createElement("link", {
            href: "/app.css",
            rel: "stylesheet",
          }),
          "Ready",
        ),
      ),
    );

    expect(container.textContent).toBe("Ready");
    expect(head.childNodes).toHaveLength(1);
    expect(head.childNodes[0]).toBe(existing);
  });

  it("renders identical sibling resources as one head element", () => {
    const { head, root } = documentResourceRoot();
    const link = () =>
      createElement("link", { href: "/app.css", rel: "stylesheet" });

    flushSync(() => root.render(createElement("main", null, link(), link())));

    expect(head.childNodes).toHaveLength(1);
    expect((head.childNodes[0] as FakeElement).attributes).toEqual({
      href: "/app.css",
      rel: "stylesheet",
    });
  });

  it("removes document metadata from the head with its last owner", () => {
    const { container, head, root } = documentResourceRoot();
    const description = () =>
      createElement("meta", { content: "Fig", name: "description" });

    flushSync(() =>
      root.render(
        createElement(
          "main",
          null,
          createElement("title", null, "Settings"),
          description(),
          description(),
          "Body",
        ),
      ),
    );

    expect(head.childNodes).toHaveLength(2);
    expect((head.childNodes[0] as FakeElement).textContent).toBe("Settings");

    flushSync(() =>
      root.render(createElement("main", null, description(), "Body")),
    );

    expect(head.childNodes).toHaveLength(1);
    expect((head.childNodes[0] as FakeElement).attributes).toEqual({
      content: "Fig",
      name: "description",
    });

    flushSync(() => root.render(createElement("main", null, "Body")));

    expect(head.childNodes).toHaveLength(0);
    expect(container.textContent).toBe("Body");
  });

  it("releases document metadata nested under a removed ancestor", () => {
    const { head, root } = documentResourceRoot();

    flushSync(() =>
      root.render(
        createElement(
          "main",
          null,
          createElement(
            "div",
            null,
            createElement("title", null, "Page"),
            createElement("meta", { content: "Fig", name: "description" }),
          ),
        ),
      ),
    );

    expect(head.childNodes).toHaveLength(2);

    flushSync(() => root.render(createElement("main", null, "Empty")));

    expect(head.childNodes).toHaveLength(0);
  });

  it("balances resource counts across discarded suspended renders", async () => {
    const { head, root } = documentResourceRoot();
    const pending = deferred<string>();

    function Reader() {
      return createElement("span", null, readPromise(pending.promise));
    }

    flushSync(() =>
      root.render(
        createElement(
          "main",
          null,
          createElement(
            Suspense,
            { fallback: "Loading" },
            createElement(
              "div",
              null,
              createElement("meta", { content: "Fig", name: "description" }),
              createElement(Reader, null),
            ),
          ),
        ),
      ),
    );

    pending.resolve("Ready");
    await delay();

    expect(head.childNodes).toHaveLength(1);

    flushSync(() => root.render(createElement("main", null, "Empty")));

    expect(head.childNodes).toHaveLength(0);
  });

  it("dedupes a resource rekeyed into an existing identity", () => {
    const { head, root } = documentResourceRoot();
    const app = (firstName: string) =>
      createElement(
        "main",
        null,
        createElement("meta", { content: "one", name: firstName }),
        createElement("meta", { content: "two", name: "b" }),
      );

    flushSync(() => root.render(app("a")));
    expect(head.childNodes).toHaveLength(2);

    // Rekeying the first meta into the second's key adopts the existing
    // element instead of leaving a duplicate.
    flushSync(() => root.render(app("b")));
    expect(head.childNodes).toHaveLength(1);

    flushSync(() => root.render(createElement("main", null, "Empty")));
    expect(head.childNodes).toHaveLength(0);
  });

  it("keeps the shared title updatable after another owner unmounts", () => {
    const { head, root } = documentResourceRoot();
    const app = (first: string, modal: boolean) =>
      createElement(
        "main",
        null,
        createElement("title", null, first),
        modal ? createElement("title", null, "Modal") : null,
      );

    flushSync(() => root.render(app("Home", true)));
    expect(head.childNodes).toHaveLength(1);
    expect((head.childNodes[0] as FakeElement).textContent).toBe("Modal");

    flushSync(() => root.render(app("Home", false)));
    flushSync(() => root.render(app("Dashboard", false)));

    expect(head.childNodes).toHaveLength(1);
    expect((head.childNodes[0] as FakeElement).textContent).toBe("Dashboard");
  });

  it("keeps stylesheets in the head after their owner unmounts", () => {
    const { head, root } = documentResourceRoot();

    flushSync(() =>
      root.render(
        createElement(
          "main",
          null,
          createElement("link", { href: "/app.css", rel: "stylesheet" }),
          "Styled",
        ),
      ),
    );
    flushSync(() => root.render(createElement("main", null, "Plain")));

    expect(head.childNodes).toHaveLength(1);

    flushSync(() =>
      root.render(
        createElement(
          "main",
          null,
          createElement("link", { href: "/app.css", rel: "stylesheet" }),
          "Styled",
        ),
      ),
    );

    expect(head.childNodes).toHaveLength(1);
  });

  it("re-keys document resources when their props change", () => {
    const { head, root } = documentResourceRoot();
    const app = (href: string) =>
      createElement(
        "main",
        null,
        createElement("link", { href, rel: "stylesheet" }),
      );

    flushSync(() => root.render(app("/one.css")));
    flushSync(() => root.render(app("/two.css")));

    // The old stylesheet persists (its load cannot be undone); the owner now
    // holds a fresh element for the new identity.
    expect(head.childNodes).toHaveLength(2);
    expect((head.childNodes[0] as FakeElement).attributes).toEqual({
      href: "/one.css",
      rel: "stylesheet",
    });
    expect((head.childNodes[1] as FakeElement).attributes).toEqual({
      href: "/two.css",
      rel: "stylesheet",
    });

    flushSync(() =>
      root.render(
        createElement(
          "main",
          null,
          createElement("link", { href: "/two.css", rel: "stylesheet" }),
          createElement("link", { href: "/two.css", rel: "stylesheet" }),
        ),
      ),
    );

    expect(head.childNodes).toHaveLength(2);
  });

  it("preserves shared resources when one owner changes identity", () => {
    const { head, root } = documentResourceRoot();
    const app = (firstName: string) =>
      createElement(
        "main",
        null,
        createElement("meta", { content: "shared", name: firstName }),
        createElement("meta", { content: "shared", name: "a" }),
      );

    flushSync(() => root.render(app("a")));
    expect(head.childNodes).toHaveLength(1);

    flushSync(() => root.render(app("b")));

    // The remaining owner keeps the untouched shared element; the rekeyed
    // owner gets its own element for the new identity.
    const names = head.childNodes
      .map((child) => (child as FakeElement).attributes.name)
      .sort();
    expect(names).toEqual(["a", "b"]);

    flushSync(() => root.render(createElement("main", null, "Empty")));
    expect(head.childNodes).toHaveLength(0);
  });

  it("inserts asset resources shadowed by a discarded render's element", async () => {
    const { container, head, root } = documentResourceRoot();
    const pending = deferred<string>();

    function Reader() {
      return createElement("span", null, readPromise(pending.promise));
    }

    flushSync(() =>
      root.render(
        createElement(
          "main",
          null,
          createElement(
            Suspense,
            { fallback: "Loading" },
            createElement("link", {
              href: "/late.css",
              media: "print",
              rel: "stylesheet",
            }),
            createElement(Reader, null),
          ),
        ),
      ),
    );

    // The suspended render adopted the link but never committed it, leaving
    // a detached zero-count element whose attributes come from host props.
    expect(head.childNodes).toHaveLength(0);

    void insertAssetResources([stylesheet("/late.css")]);

    // The stale element is discarded: the inserted element reflects the
    // descriptor, not the aborted render's media="print" props.
    expect(head.childNodes).toHaveLength(1);
    expect((head.childNodes[0] as FakeElement).attributes).toEqual({
      href: "/late.css",
      rel: "stylesheet",
    });

    // The revealed primary tree adopts the authoritative element instead of
    // committing its stale one alongside it.
    pending.resolve("Ready");
    await delay();

    expect(container.textContent).toBe("Ready");
    expect(head.childNodes).toHaveLength(1);
    expect((head.childNodes[0] as FakeElement).attributes).toEqual({
      href: "/late.css",
      rel: "stylesheet",
    });
  });
});

function documentResourceRoot(): {
  container: FakeElement;
  head: FakeElement;
  root: ReturnType<typeof createRoot>;
} {
  const container = new FakeElement("root");
  const head = new FakeElement("head");
  (document as unknown as { head: Element }).head = head as unknown as Element;
  return {
    container,
    head,
    root: createRoot(container as unknown as Element),
  };
}
