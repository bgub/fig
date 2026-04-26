import { describe, expect, it } from "vitest";
import { createElement, Fragment, isValidElement, useState } from "./index.ts";

describe("@bgub/fig", () => {
  it("creates elements with keys and normalized children", () => {
    const element = createElement("div", { key: "a", id: "root" }, "hello", 1);

    expect(isValidElement(element)).toBe(true);
    expect(element.type).toBe("div");
    expect(element.key).toBe("a");
    expect(element.props).toEqual({ id: "root", children: ["hello", 1] });
  });

  it("supports fragments as element types", () => {
    const element = createElement(Fragment, null, "child");

    expect(element.type).toBe(Fragment);
    expect(element.props.children).toBe("child");
  });

  it("throws when hooks are called outside render", () => {
    expect(() => useState(0)).toThrow(
      "Hooks can only be called while rendering a component.",
    );
  });
});
