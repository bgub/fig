import { createElement } from "./element.ts";
import { collectChildren } from "./children.ts";
import { describe, expect, it } from "vitest";

describe("child normalization", () => {
  it("reuses arrays that are already normalized", () => {
    const child = createElement("span", null, "child");
    const promise = Promise.resolve("later");
    const children = ["before", child, promise, "after"];

    expect(collectChildren(children)).toBe(children);
  });

  it("observes thenables once when a later child needs normalization", () => {
    const promise = Promise.resolve("later");
    let reads = 0;
    const thenable = {
      // oxlint-disable-next-line unicorn/no-thenable -- verifies access is not repeated during normalization
      get then() {
        reads += 1;
        return promise.then.bind(promise);
      },
    };

    const children = collectChildren([thenable, 0]);

    expect(reads).toBe(1);
    expect(children[0]).toBe(thenable);
    expect(children[1]).toBe("0");
  });

  it("drops empty strings without creating child slots", () => {
    const child = createElement("span", null, "child");

    expect(collectChildren(["", "before", "", 0, "", child, ""])).toEqual([
      "before0",
      child,
    ]);
  });

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
