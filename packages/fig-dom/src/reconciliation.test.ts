import { createElement, Fragment } from "@bgub/fig";
import { describe, expect, it } from "vite-plus/test";
import { createRoot, flushSync } from "./index.ts";
import { FakeElement, installFakeDocument } from "./test-utils.ts";

installFakeDocument();

describe("@bgub/fig-dom reconciliation", () => {
  it("replaces text, elements, and empty children at the same position", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement("div", null, "A")));
    expect(container.textContent).toBe("A");

    flushSync(() =>
      root.render(createElement("div", null, createElement("span", null, "B"))),
    );
    expect(container.textContent).toBe("B");
    expect(
      (container.childNodes[0] as FakeElement).childNodes[0],
    ).toBeInstanceOf(FakeElement);

    flushSync(() => root.render(createElement("div", null, null, false, "C")));
    expect(container.textContent).toBe("C");
    expect((container.childNodes[0] as FakeElement).childNodes).toHaveLength(1);
  });

  it("moves keyed fragments and component subtrees through host siblings", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    function Item({ value }: { value: string }) {
      return createElement("span", null, value);
    }

    const fragment = createElement(
      Fragment,
      { key: "fragment" },
      createElement("span", null, "A"),
      createElement("span", null, "B"),
    );
    const item = createElement(Item, { key: "item", value: "I" });
    const stable = createElement("span", { key: "stable" }, "S");

    flushSync(() =>
      root.render(createElement("div", null, fragment, item, stable)),
    );
    expect(container.textContent).toBe("ABIS");

    flushSync(() =>
      root.render(createElement("div", null, item, fragment, stable)),
    );
    expect(container.textContent).toBe("IABS");

    flushSync(() =>
      root.render(createElement("div", null, fragment, item, stable)),
    );
    expect(container.textContent).toBe("ABIS");
  });

  it("removes fragment children without leaving host wrappers", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    function Pair({ show }: { show: boolean }) {
      return createElement(
        "main",
        null,
        show
          ? createElement(
              Fragment,
              null,
              createElement("span", null, "A"),
              createElement("span", null, "B"),
            )
          : null,
        createElement("span", null, "C"),
      );
    }

    flushSync(() => root.render(createElement(Pair, { show: true })));

    const main = container.childNodes[0] as FakeElement;
    expect(main.childNodes).toHaveLength(3);
    expect(main.textContent).toBe("ABC");

    flushSync(() => root.render(createElement(Pair, { show: false })));

    expect(main.childNodes).toHaveLength(1);
    expect(main.textContent).toBe("C");
  });
});
