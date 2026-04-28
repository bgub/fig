import { describe, expect, it } from "vitest";
import {
  createContext,
  createElement,
  Fragment,
  isContext,
  isSuspense,
  isValidElement,
  readContext,
  readPromise,
  Suspense,
  useState,
} from "./index.ts";

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

  it("supports Suspense as a special element type", () => {
    const element = createElement(Suspense, { fallback: "Loading" }, "Loaded");
    const emptyFallback = createElement(Suspense, null, "Loaded");

    expect(isSuspense(Suspense)).toBe(true);
    expect(isValidElement(element)).toBe(true);
    expect(element.type).toBe(Suspense);
    expect(element.props).toEqual({
      fallback: "Loading",
      children: "Loaded",
    });
    expect(emptyFallback.props).toEqual({ children: "Loaded" });
  });

  it("creates callable contexts", () => {
    const Theme = createContext("light");
    const element = createElement(Theme, { value: "dark" }, "child");

    expect(isContext(Theme)).toBe(true);
    expect(Theme.defaultValue).toBe("light");
    expect(element.type).toBe(Theme);
    expect(element.props).toEqual({ value: "dark", children: "child" });
  });

  it("throws when hooks are called outside render", () => {
    expect(() => useState(0)).toThrow(
      "Hooks can only be called while rendering a component.",
    );
  });

  it("throws when read APIs are called outside render", () => {
    const Theme = createContext("light");

    expect(() => readContext(Theme)).toThrow(
      "readContext can only be called while rendering a component.",
    );
    expect(() => readPromise(Promise.resolve("done"))).toThrow(
      "readPromise can only be called while rendering a component.",
    );
  });
});
