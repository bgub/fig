import {
  font,
  meta,
  modulepreload,
  preload,
  script,
  stylesheet,
  title,
  type FigResource,
} from "@bgub/fig";
import { describe, expect, it } from "vite-plus/test";
import { ResourceRegistry } from "./resources.ts";

function write(registry: ResourceRegistry, resource: FigResource): string {
  let html = "";
  registry.write(resource, {
    write(chunk) {
      html += chunk;
    },
  });
  return html;
}

describe("ResourceRegistry", () => {
  it("dedupes identical stylesheet resources", () => {
    const registry = new ResourceRegistry("");
    const resource = stylesheet("/app.css", { media: "screen" });

    expect(write(registry, resource)).toBe(
      '<link rel="stylesheet" href="/app.css" id="r-0" media="screen">',
    );
    expect(write(registry, stylesheet("/app.css", { media: "screen" }))).toBe(
      "",
    );
  });

  it("defaults scripts to async unless they opt into defer ordering", () => {
    const registry = new ResourceRegistry("");

    expect(write(registry, script("/plain.js"))).toBe(
      '<script src="/plain.js" async></script>',
    );
    expect(write(registry, script("/ordered.js", { defer: true }))).toBe(
      '<script src="/ordered.js" defer></script>',
    );
    expect(
      write(registry, script("/both.js", { async: true, defer: true })),
    ).toBe('<script src="/both.js" async defer></script>');
    expect(write(registry, script("/sync.js", { async: false }))).toBe(
      '<script src="/sync.js"></script>',
    );
  });

  it("rejects stylesheet resources with the same href and different media", () => {
    const registry = new ResourceRegistry("");

    write(registry, stylesheet("/app.css", { media: "screen" }));

    expect(() =>
      write(registry, stylesheet("/app.css", { media: "print" })),
    ).toThrow(
      'Conflicting Fig resource for key "stylesheet:/app.css". Existing: {"media":"screen","href":"/app.css","kind":"stylesheet"}. Incoming: {"media":"print","href":"/app.css","kind":"stylesheet"}.',
    );
  });

  it("rejects conflicting title and meta resources", () => {
    const registry = new ResourceRegistry("");

    registry.register(title("Dashboard"));
    registry.register(meta({ name: "description", content: "One" }));

    expect(() => registry.register(title("Settings"))).toThrow(
      'Conflicting Fig resource for key "title". Existing: {"kind":"title","value":"Dashboard"}. Incoming: {"kind":"title","value":"Settings"}.',
    );
    expect(() =>
      registry.register(meta({ name: "description", content: "Two" })),
    ).toThrow('Conflicting Fig resource for key "meta:name:description".');
  });

  it("dedupes a font against an equivalent preload-as-font under one key", () => {
    const registry = new ResourceRegistry("");

    // font() and preload(href, "font") emit byte-identical markup and now share
    // the preload-font key space, so the second must dedupe rather than conflict.
    expect(write(registry, font("/a.woff2", "font/woff2"))).toBe(
      '<link rel="preload" href="/a.woff2" as="font" type="font/woff2" crossorigin="anonymous">',
    );
    expect(
      write(
        registry,
        preload("/a.woff2", "font", {
          type: "font/woff2",
          crossOrigin: "anonymous",
        }),
      ),
    ).toBe("");
  });

  it("keeps the title singleton even when a title carries an explicit key", () => {
    const registry = new ResourceRegistry("");

    registry.register(title("Dashboard", "primary"));

    // An explicit key must not let a second title escape the one-<title> model.
    expect(() => registry.register(title("Settings", "secondary"))).toThrow(
      'Conflicting Fig resource for key "title".',
    );
  });

  it("dedupes identical preloads and keeps different preload targets distinct", () => {
    const registry = new ResourceRegistry("");

    expect(write(registry, preload("/asset", "image"))).toBe(
      '<link rel="preload" href="/asset" as="image">',
    );
    expect(write(registry, preload("/asset", "image"))).toBe("");
    expect(write(registry, preload("/asset", "script"))).toBe(
      '<link rel="preload" href="/asset" as="script">',
    );
  });

  it("writes and dedupes modulepreloads", () => {
    const registry = new ResourceRegistry("");

    expect(
      write(
        registry,
        modulepreload("/chunk.js", {
          crossOrigin: "anonymous",
          fetchPriority: "high",
        }),
      ),
    ).toBe(
      '<link rel="modulepreload" href="/chunk.js" crossorigin="anonymous" fetchpriority="high">',
    );
    expect(
      write(
        registry,
        modulepreload("/chunk.js", {
          crossOrigin: "anonymous",
          fetchPriority: "high",
        }),
      ),
    ).toBe("");
    expect(() => write(registry, modulepreload("/chunk.js"))).toThrow(
      'Conflicting Fig resource for key "modulepreload:/chunk.js".',
    );
  });

  it("rejects preloads with the same target and different behavior", () => {
    const registry = new ResourceRegistry("");

    write(registry, preload("/asset", "image", { fetchPriority: "high" }));

    expect(() =>
      write(registry, preload("/asset", "image", { fetchPriority: "low" })),
    ).toThrow('Conflicting Fig resource for key "preload:image:/asset".');
  });
});
