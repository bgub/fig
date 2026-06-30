import {
  font,
  modulepreload,
  preconnect,
  preload,
  stylesheet,
} from "@bgub/fig";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
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
