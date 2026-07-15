import {
  font,
  modulepreload,
  preconnect,
  preload,
  script,
  stylesheet,
} from "@bgub/fig";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { insertAssetResources } from "./index.ts";
import { FakeElement } from "./test-utils.ts";

describe("@bgub/fig-dom asset resources", () => {
  let head: FakeElement;
  let previousDocument: typeof globalThis.document;
  let previousMatchMedia: typeof globalThis.matchMedia;

  beforeEach(() => {
    previousDocument = globalThis.document;
    previousMatchMedia = globalThis.matchMedia;
    head = new FakeElement("head");
    globalThis.document = {
      head,
      createElement: (tag: string) => new FakeElement(tag),
    } as unknown as Document;
  });

  afterEach(() => {
    globalThis.document = previousDocument;
    globalThis.matchMedia = previousMatchMedia;
  });

  function links(): FakeElement[] {
    return head.childNodes.filter(
      (child): child is FakeElement => child instanceof FakeElement,
    );
  }

  it("inserts asset resources into the document head", () => {
    void insertAssetResources([
      stylesheet("/a.css"),
      preload("/a.js", "script"),
      modulepreload("/b.js"),
    ]);

    const inserted = links();
    expect(inserted).toHaveLength(3);
    expect(inserted[0]?.tagName).toBe("link");
    expect(inserted[0]?.getAttribute("rel")).toBe("stylesheet");
    expect(inserted[0]?.getAttribute("href")).toBe("/a.css");
    expect(inserted[1]?.getAttribute("rel")).toBe("preload");
    expect(inserted[1]?.getAttribute("as")).toBe("script");
    expect(inserted[2]?.getAttribute("rel")).toBe("modulepreload");
    expect(inserted[2]?.getAttribute("href")).toBe("/b.js");
  });

  it("orders stylesheets deterministically across discovery batches", () => {
    void insertAssetResources([
      stylesheet("/theme.css", { precedence: "theme" }),
      stylesheet("/z-reset.css", { precedence: "reset" }),
    ]);
    void insertAssetResources([
      stylesheet("/a-reset.css", { precedence: "reset" }),
    ]);

    expect(links().map((link) => link.getAttribute("href"))).toEqual([
      "/a-reset.css",
      "/z-reset.css",
      "/theme.css",
    ]);
  });

  it("dedupes by key within a call and across calls", () => {
    void insertAssetResources([stylesheet("/a.css"), stylesheet("/a.css")]);
    void insertAssetResources([stylesheet("/a.css")]);

    expect(links()).toHaveLength(1);
  });

  it("dedupes against a server-rendered head element", () => {
    const ssr = new FakeElement("link");
    ssr.setAttribute("rel", "stylesheet");
    ssr.setAttribute("href", "/a.css");
    head.appendChild(ssr);

    void insertAssetResources([stylesheet("/a.css")]);

    expect(links()).toHaveLength(1);
  });

  it("dedupes an explicit non-async script against server output", () => {
    const ssr = new FakeElement("script");
    ssr.setAttribute("src", "/ordered.js");
    head.appendChild(ssr);

    void insertAssetResources([script("/ordered.js", { async: false })]);

    expect(links()).toHaveLength(1);
  });

  it("does not gate on server-rendered head stylesheets", async () => {
    const ssr = new FakeElement("link");
    ssr.setAttribute("rel", "stylesheet");
    ssr.setAttribute("href", "/a.css");
    head.appendChild(ssr);

    let settled = false;
    const ready = insertAssetResources([stylesheet("/a.css")]);
    void ready.then(() => {
      settled = true;
    });

    await Promise.resolve();

    expect(links()).toHaveLength(1);
    expect(settled).toBe(true);
  });

  it("gates on an existing stylesheet that is still loading", async () => {
    const existing = new FakeElement("link") as FakeElement & {
      sheet: StyleSheet | null;
    };
    existing.setAttribute("rel", "stylesheet");
    existing.setAttribute("href", "/a.css");
    Object.defineProperty(existing, "sheet", {
      configurable: true,
      value: null,
    });
    head.appendChild(existing);

    let settled = false;
    const ready = insertAssetResources([stylesheet("/a.css")]);
    void ready.then(() => {
      settled = true;
    });

    await Promise.resolve();

    expect(links()).toHaveLength(1);
    expect(settled).toBe(false);

    Object.defineProperty(existing, "sheet", {
      configurable: true,
      value: {},
    });
    existing.dispatch("load");
    await ready;

    expect(settled).toBe(true);
  });

  it("dedupes keyed assets against server-rendered head elements", () => {
    const ssr = new FakeElement("link");
    ssr.setAttribute("rel", "stylesheet");
    ssr.setAttribute("href", "/hashed.css");
    ssr.setAttribute("data-fig-resource-key", "component-style");
    head.appendChild(ssr);

    void insertAssetResources([
      stylesheet("/hashed.css", { key: "component-style" }),
    ]);

    expect(links()).toHaveLength(1);
  });

  it("dedupes a font against a server-rendered font preload", () => {
    const ssr = new FakeElement("link");
    ssr.setAttribute("rel", "preload");
    ssr.setAttribute("as", "font");
    ssr.setAttribute("href", "/a.woff2");
    head.appendChild(ssr);

    // A font is inserted as <link rel="preload" as="font">, so it must dedupe
    // against an existing font preload under one key space.
    void insertAssetResources([font("/a.woff2", "font/woff2")]);
    void insertAssetResources([preload("/a.woff2", "font")]);

    expect(links()).toHaveLength(1);
  });

  it("gates later dependents on a pending inserted stylesheet", async () => {
    let firstSettled = false;
    let secondSettled = false;
    const first = insertAssetResources([stylesheet("/a.css")]);
    const second = insertAssetResources([stylesheet("/a.css")]);
    void first.then(() => {
      firstSettled = true;
    });
    void second.then(() => {
      secondSettled = true;
    });

    await Promise.resolve();

    expect(links()).toHaveLength(1);
    expect(firstSettled).toBe(false);
    expect(secondSettled).toBe(false);

    links()[0]?.dispatch("load");
    await Promise.all([first, second]);

    expect(firstSettled).toBe(true);
    expect(secondSettled).toBe(true);
  });

  it("does not gate on an already-loaded inserted stylesheet", async () => {
    const first = insertAssetResources([stylesheet("/a.css")]);
    links()[0]?.dispatch("load");
    await first;

    let settled = false;
    const second = insertAssetResources([stylesheet("/a.css")]);
    void second.then(() => {
      settled = true;
    });

    await Promise.resolve();

    expect(links()).toHaveLength(1);
    expect(settled).toBe(true);
  });

  it("gates reveal on a critical stylesheet load", async () => {
    let settled = false;
    const ready = insertAssetResources([stylesheet("/a.css")]);
    void ready.then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    links()[0]?.dispatch("load");
    await ready;
    expect(settled).toBe(true);
  });

  it("resolves the gate when a stylesheet fails to load", async () => {
    const ready = insertAssetResources([stylesheet("/a.css")]);
    links()[0]?.dispatch("error");

    await expect(ready).resolves.toBeUndefined();
  });

  it("does not gate on non-critical resources", async () => {
    await expect(
      insertAssetResources([
        preload("/a.js", "script"),
        modulepreload("/b.js"),
        preconnect("https://cdn.example.com"),
        stylesheet("/b.css", { blocking: "none" }),
        font("/a.woff2", "font/woff2"),
      ]),
    ).resolves.toBeUndefined();
  });

  it("does not gate duplicate non-blocking stylesheets", async () => {
    void insertAssetResources([stylesheet("/a.css", { blocking: "none" })]);

    await expect(
      insertAssetResources([stylesheet("/a.css", { blocking: "none" })]),
    ).resolves.toBeUndefined();
    expect(links()).toHaveLength(1);
  });

  it("does not gate on media-mismatched stylesheets", async () => {
    globalThis.matchMedia = (query: string) =>
      ({
        matches: query === "screen",
      }) as MediaQueryList;

    await expect(
      insertAssetResources([stylesheet("/print.css", { media: "print" })]),
    ).resolves.toBeUndefined();
  });

  it("ignores invalid asset descriptors", async () => {
    await expect(
      insertAssetResources([
        { href: "/unknown.asset", kind: "unknown" } as never,
      ]),
    ).resolves.toBeUndefined();

    expect(links()).toHaveLength(0);
  });
});
