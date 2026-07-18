import {
  type FigAssetResource,
  font,
  meta,
  modulepreload,
  preload,
  script,
  stylesheet,
  title,
} from "@bgub/fig";
import { describe, expect, it } from "vitest";
import { AssetResourceRegistry } from "./asset-registry.ts";

function write(
  registry: AssetResourceRegistry,
  resource: FigAssetResource,
): string {
  let html = "";
  registry.write(resource, {
    write(chunk) {
      html += chunk;
    },
  });
  return html;
}

describe("AssetResourceRegistry", () => {
  it("dedupes identical stylesheet resources", () => {
    const registry = new AssetResourceRegistry("");
    const resource = stylesheet("/app.css", { media: "screen" });

    expect(write(registry, resource)).toBe(
      '<link data-fig-hydration-skip rel="stylesheet" href="/app.css" media="screen" id="r-0">',
    );
    expect(write(registry, stylesheet("/app.css", { media: "screen" }))).toBe(
      "",
    );
  });

  it("defaults scripts to async unless they opt into defer ordering", () => {
    const registry = new AssetResourceRegistry("");

    expect(write(registry, script("/plain.js"))).toBe(
      '<script data-fig-hydration-skip src="/plain.js" async></script>',
    );
    expect(write(registry, script("/ordered.js", { defer: true }))).toBe(
      '<script data-fig-hydration-skip src="/ordered.js" defer></script>',
    );
    expect(
      write(registry, script("/both.js", { async: true, defer: true })),
    ).toBe(
      '<script data-fig-hydration-skip src="/both.js" async defer></script>',
    );
    expect(write(registry, script("/sync.js", { async: false }))).toBe(
      '<script data-fig-hydration-skip src="/sync.js"></script>',
    );
  });

  it("rejects stylesheet resources with the same href and different media", () => {
    const registry = new AssetResourceRegistry("");

    write(registry, stylesheet("/app.css", { media: "screen" }));

    expect(() =>
      write(registry, stylesheet("/app.css", { media: "print" })),
    ).toThrow(
      'Conflicting Fig resource for key "stylesheet:/app.css". Existing: {"media":"screen","href":"/app.css","kind":"stylesheet"}. Incoming: {"media":"print","href":"/app.css","kind":"stylesheet"}.',
    );
  });

  it("lets later title resources replace the singleton slot", () => {
    const registry = new AssetResourceRegistry("");

    registry.register(title("Dashboard"));
    registry.register(title("Settings"));

    expect(registry.headHtml()).toBe(
      "<title data-fig-hydration-skip>Settings</title>",
    );
  });

  it("rejects conflicting meta resources", () => {
    const registry = new AssetResourceRegistry("");

    registry.register(title("Dashboard"));
    registry.register(meta({ name: "description", content: "One" }));

    expect(() =>
      registry.register(meta({ name: "description", content: "Two" })),
    ).toThrow('Conflicting Fig resource for key "meta:name:description".');
  });

  it("writes native meta descriptor attributes", () => {
    const registry = new AssetResourceRegistry("");

    registry.register(meta({ "http-equiv": "refresh", content: "30" }));

    expect(registry.headHtml()).toBe(
      '<meta http-equiv="refresh" content="30" data-fig-hydration-skip>',
    );
  });

  it("dedupes a font against an equivalent preload-as-font under one key", () => {
    const registry = new AssetResourceRegistry("");

    // font() and preload(href, "font") emit byte-identical markup and now share
    // the preload-font key space, so the second must dedupe rather than conflict.
    expect(write(registry, font("/a.woff2", "font/woff2"))).toBe(
      '<link data-fig-hydration-skip rel="preload" href="/a.woff2" as="font" type="font/woff2" crossorigin="anonymous">',
    );
    expect(
      write(
        registry,
        preload("/a.woff2", "font", {
          type: "font/woff2",
          crossorigin: "anonymous",
        }),
      ),
    ).toBe("");
  });

  it("dedupes explicitly keyed fonts against equivalent keyed preloads", () => {
    const registry = new AssetResourceRegistry("");

    expect(
      write(registry, font("/brand.woff2", "font/woff2", { key: "brand" })),
    ).toBe(
      '<link data-fig-hydration-skip rel="preload" href="/brand.woff2" as="font" data-fig-resource-key="brand" type="font/woff2" crossorigin="anonymous">',
    );
    expect(
      write(
        registry,
        preload("/brand.woff2", "font", {
          crossorigin: "anonymous",
          key: "brand",
          type: "font/woff2",
        }),
      ),
    ).toBe("");
  });

  it("keeps the title singleton by replacing it", () => {
    const registry = new AssetResourceRegistry("");

    registry.register(title("Dashboard"));
    registry.register(title("Settings"));

    expect(registry.headHtml()).toBe(
      "<title data-fig-hydration-skip>Settings</title>",
    );
  });

  it("dedupes identical preloads and keeps different preload targets distinct", () => {
    const registry = new AssetResourceRegistry("");

    expect(write(registry, preload("/asset", "image"))).toBe(
      '<link data-fig-hydration-skip rel="preload" href="/asset" as="image">',
    );
    expect(write(registry, preload("/asset", "image"))).toBe("");
    expect(write(registry, preload("/asset", "script"))).toBe(
      '<link data-fig-hydration-skip rel="preload" href="/asset" as="script">',
    );
  });

  it("writes and dedupes modulepreloads", () => {
    const registry = new AssetResourceRegistry("");

    expect(
      write(
        registry,
        modulepreload("/chunk.js", {
          crossorigin: "anonymous",
          fetchpriority: "high",
        }),
      ),
    ).toBe(
      '<link data-fig-hydration-skip rel="modulepreload" href="/chunk.js" crossorigin="anonymous" fetchpriority="high">',
    );
    expect(
      write(
        registry,
        modulepreload("/chunk.js", {
          crossorigin: "anonymous",
          fetchpriority: "high",
        }),
      ),
    ).toBe("");
    expect(() => write(registry, modulepreload("/chunk.js"))).toThrow(
      'Conflicting Fig resource for key "modulepreload:/chunk.js".',
    );
  });

  it("rejects preloads with the same target and different behavior", () => {
    const registry = new AssetResourceRegistry("");

    write(registry, preload("/asset", "image", { fetchpriority: "high" }));

    expect(() =>
      write(registry, preload("/asset", "image", { fetchpriority: "low" })),
    ).toThrow('Conflicting Fig resource for key "preload:image:/asset".');
  });
});
