import { createContext, createElement, readContext } from "@bgub/fig";
import { describe, expect, it } from "vitest";
import { createRoot, flushSync } from "./index.ts";
import { FakeElement, installFakeDocument } from "./test-utils.ts";

installFakeDocument();

describe("@bgub/fig-dom context", () => {
  it("reads context defaults and nearest providers", () => {
    const Theme = createContext("default");

    function Label() {
      return createElement("span", null, readContext(Theme));
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement(Label, null)));
    expect(container.textContent).toBe("default");

    flushSync(() =>
      root.render(
        createElement(
          Theme,
          { value: "outer" },
          createElement(Theme, { value: "inner" }, createElement(Label, null)),
        ),
      ),
    );

    expect(container.textContent).toBe("inner");
  });

  it("updates context consumers behind stable children", () => {
    const Theme = createContext("light");
    const child = createElement(Label, null);
    let renders = 0;

    function Label() {
      renders += 1;
      return createElement("span", null, readContext(Theme));
    }

    function App({ value }: { value: string }) {
      return createElement(Theme, { value }, child);
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement(App, { value: "dark" })));
    expect(container.textContent).toBe("dark");

    flushSync(() => root.render(createElement(App, { value: "light" })));
    expect(container.textContent).toBe("light");
    // Each pass renders twice in development (strict shadow pass).
    expect(renders).toBe(4);
  });

  it("does not rerender stable non-consumers when providers change", () => {
    const Theme = createContext("light");
    const child = createElement(Child, null);
    const label = createElement(Label, null);
    let childRenders = 0;
    let labelRenders = 0;

    function Child() {
      childRenders += 1;
      return createElement("span", null, "Static");
    }

    function Label() {
      labelRenders += 1;
      return createElement("span", null, readContext(Theme));
    }

    function App({ value }: { value: string }) {
      return createElement(Theme, { value }, child, label);
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement(App, { value: "dark" })));
    flushSync(() => root.render(createElement(App, { value: "light" })));

    expect(container.textContent).toBe("Staticlight");
    expect(childRenders).toBe(2);
    expect(labelRenders).toBe(4);
  });

  it("does not propagate outer context changes through inner providers", () => {
    const Theme = createContext("outer");
    const inner = createElement(
      Theme,
      { value: "inner" },
      createElement(Label, null),
    );
    let renders = 0;

    function Label() {
      renders += 1;
      return createElement("span", null, readContext(Theme));
    }

    function App({ value }: { value: string }) {
      return createElement(Theme, { value }, inner);
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement(App, { value: "first" })));
    flushSync(() => root.render(createElement(App, { value: "second" })));

    expect(container.textContent).toBe("inner");
    expect(renders).toBe(2);
  });

  it("allows context reads inside conditional branches", () => {
    const Theme = createContext("light");

    function Label({ enabled }: { enabled: boolean }) {
      return createElement(
        "span",
        null,
        enabled ? readContext(Theme) : "disabled",
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement(
          Theme,
          { value: "dark" },
          createElement(Label, { enabled: false }),
        ),
      ),
    );
    expect(container.textContent).toBe("disabled");

    flushSync(() =>
      root.render(
        createElement(
          Theme,
          { value: "dark" },
          createElement(Label, { enabled: true }),
        ),
      ),
    );
    expect(container.textContent).toBe("dark");
  });
  it("updates only matching consumers when more than 32 contexts share a renderer", () => {
    const contexts = Array.from({ length: 64 }, () => createContext(0));
    const values = contexts.map(() => 0);
    const renders = contexts.map(() => 0);
    let innerRenders = 0;

    function Consumer({ index }: { index: number }) {
      renders[index] += 1;
      return createElement(
        "span",
        null,
        `${index}:${readContext(contexts[index])}|`,
      );
    }
    function InnerConsumer() {
      innerRenders += 1;
      return createElement("span", null, `inner:${readContext(contexts[31])}`);
    }
    const children = createElement(
      "main",
      null,
      contexts.map((_, index) =>
        createElement(Consumer, { key: index, index }),
      ),
      createElement(
        contexts[31],
        { value: 99 },
        createElement(InnerConsumer, null),
      ),
    );
    function tree() {
      return contexts.reduceRight(
        (child, context, index) =>
          createElement(context, { value: values[index] }, child),
        children,
      );
    }
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    flushSync(() => root.render(tree()));
    const initialInnerRenders = innerRenders;
    // Exercise the signed bit and both halves of the wraparound independently.
    for (const index of [0, 31, 32, 63, 0]) {
      const before = [...renders];
      values[index] += 1;
      flushSync(() => root.render(tree()));
      expect(container.textContent).toBe(
        values.map((value, i) => `${i}:${value}|`).join("") + "inner:99",
      );
      expect(renders.map((count, i) => count - before[i])).toEqual(
        contexts.map((_, i) => (i === index ? 2 : 0)),
      );
      expect(innerRenders).toBe(initialInnerRenders);
    }
    flushSync(() => root.unmount());
  });
});
