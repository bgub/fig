import { createElement } from "@bgub/fig";
import { describe, expect, it } from "vitest";
import {
  hasUnsafeHTML,
  hostChildren,
  hostTextContent,
} from "./host-content.ts";

describe("host content", () => {
  it("flattens text-only children without materializing fibers", () => {
    expect(hostTextContent(["one", [2, null, false], "three"])).toBe(
      "one2three",
    );
  });

  it("rejects text-content mode when an element is present", () => {
    expect(hostTextContent(["one", createElement("span", null, "two")])).toBe(
      null,
    );
  });

  it("keeps unsafe HTML exclusive with renderable children", () => {
    const props = { children: "child", unsafeHTML: "<b>html</b>" };

    expect(hasUnsafeHTML(props)).toBe(true);
    expect(() => hostChildren(props)).toThrow(
      "Host elements cannot have both unsafeHTML and children.",
    );
    expect(hostChildren({ children: false, unsafeHTML: "<br>" })).toBeNull();
  });
});
