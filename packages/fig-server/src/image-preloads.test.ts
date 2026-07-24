import type { Props } from "@bgub/fig";
import { describe, expect, it } from "vitest";
import { imagePreloadFromHostProps } from "./image-preloads.ts";

describe("automatic image preloads", () => {
  it("derives native preload options from an eager image", () => {
    expect(
      imagePreloadFromHostProps(
        "img",
        {
          crossorigin: "use-credentials",
          fetchpriority: "high",
          referrerpolicy: "no-referrer",
          sizes: "100vw",
          src: "/fallback.jpg",
          srcset: "/small.jpg 400w, /large.jpg 800w",
          type: "image/jpeg",
        },
        false,
      ),
    ).toEqual({
      as: "image",
      crossorigin: "use-credentials",
      fetchpriority: "high",
      href: "/fallback.jpg",
      imagesizes: "100vw",
      imagesrcset: "/small.jpg 400w, /large.jpg 800w",
      kind: "preload",
      referrerpolicy: "no-referrer",
      type: "image/jpeg",
    });
  });

  it.each([
    ["lazy images", { loading: "lazy", src: "/lazy.jpg" }],
    ["low-priority images", { fetchpriority: "low", src: "/low.jpg" }],
    ["missing sources", { alt: "missing" }],
    ["data URLs", { src: "data:image/png;base64,abc" }],
    ["non-string sources", { src: 42 }],
  ] satisfies Array<[string, Props]>)("skips %s", (_label, props) => {
    expect(imagePreloadFromHostProps("img", props, false)).toBeNull();
  });

  it("skips images in suppressed host scopes", () => {
    expect(
      imagePreloadFromHostProps("img", { src: "/nested.jpg" }, true),
    ).toBeNull();
  });

  it("ignores non-image hosts", () => {
    expect(
      imagePreloadFromHostProps("source", { src: "/source.jpg" }, false),
    ).toBeNull();
  });
});
