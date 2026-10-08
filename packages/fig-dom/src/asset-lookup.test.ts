// @vitest-environment happy-dom
import { assets, createElement as h, preload } from "@bgub/fig";
import { afterEach, expect, it, vi } from "vitest";
import { createRoot, flushSync, insertAssetResources } from "./index.ts";

afterEach(() => {
  vi.restoreAllMocks();
  document.head.replaceWith(document.createElement("head"));
});

it.each(["raw", "declarative", "payload"])(
  "reads distinct %s asset attributes linearly",
  (mode) => {
    const count = 100;
    const root = createRoot(document.createElement("div"));
    const reads = vi.spyOn(Element.prototype, "getAttribute");
    try {
      const descriptors = Array.from({ length: count }, (_, index) =>
        preload(`/asset-${index}.js`, "script"),
      );
      if (mode === "payload") void insertAssetResources(descriptors);
      else
        flushSync(() =>
          root.render(
            mode === "declarative"
              ? assets(descriptors)
              : Array.from({ length: count }, (_, index) =>
                  h("link", {
                    key: index,
                    rel: "preload",
                    as: "script",
                    href: `/asset-${index}.js`,
                  }),
                ),
          ),
        );
      expect(document.head.querySelectorAll("link")).toHaveLength(count);
      // Allow normal per-asset parsing, but reject reparsing all preceding assets.
      expect(reads.mock.calls.length).toBeLessThan(count * 30);
    } finally {
      flushSync(() => root.unmount());
    }
  },
);

it("discovers an externally rekeyed managed element", () => {
  void insertAssetResources([preload("/managed.js", "script")]);
  const managed = document.head.querySelector("link")!;
  managed.href = "/external.js";
  void insertAssetResources([preload("/external.js", "script")]);
  expect(document.head.querySelectorAll("link")).toHaveLength(1);
  expect(document.head.firstChild).toBe(managed);
});

it("invalidates discovery when mutation records have already been delivered", async () => {
  const original = serverLink("/previous.js");
  document.head.appendChild(original);
  void insertAssetResources([preload("/warm.js", "script")]);
  original.href = "/external.js";
  await new Promise((resolve) => setTimeout(resolve, 0));
  void insertAssetResources([preload("/external.js", "script")]);
  expect(
    document.head.querySelectorAll('link[href="/external.js"]'),
  ).toHaveLength(1);
  expect(document.head.querySelector('link[href="/external.js"]')).toBe(
    original,
  );
});

function serverLink(href: string) {
  const link = document.createElement("link");
  link.rel = "preload";
  link.as = "script";
  link.href = href;
  return link;
}

it.each(["insert", "replace", "rekey", "reorder"])(
  "discovers same-turn external head changes: %s",
  (change) => {
    const original = serverLink(
      change === "rekey" ? "/previous.js" : "/external.js",
    );
    if (change !== "insert") document.head.appendChild(original);
    void insertAssetResources([preload("/warm.js", "script")]);
    let expected = original;
    if (change === "insert") document.head.prepend(original);
    if (change === "replace") {
      expected = serverLink("/external.js");
      original.replaceWith(expected);
    }
    if (change === "rekey") original.href = "/external.js";
    if (change === "reorder") {
      expected = serverLink("/external.js");
      document.head.appendChild(expected);
      document.head.prepend(expected);
    }
    // Do not yield: acquisition must see records before observer delivery.
    void insertAssetResources([preload("/external.js", "script")]);
    expect(document.head.querySelector('link[href="/external.js"]')).toBe(
      expected,
    );
    expect(
      document.head.querySelectorAll('link[href="/external.js"]'),
    ).toHaveLength(change === "reorder" ? 2 : 1);
  },
);
