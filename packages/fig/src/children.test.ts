import { createElement } from "./element.ts";
import { collectChildren } from "./children.ts";
import { describe, expect, it } from "vitest";

describe("child normalization", () => {
  it("preserves promise children as slots between text children", () => {
    const promise = Promise.resolve("middle");

    expect(collectChildren(["before", promise, "after"])).toEqual([
      "before",
      promise,
      "after",
    ]);
  });

  it("gives Fig element brands precedence over incidental then methods", () => {
    const element = createElement("span", null, "child");
    // oxlint-disable-next-line unicorn/no-thenable -- verifies brand precedence over structural thenables
    Reflect.defineProperty(element, "then", {
      value: () => undefined,
    });

    expect(collectChildren(element)).toEqual([element]);
  });
});
