import { createContext, createElement, readContext } from "@bgub/fig";
import { describe, expect, it } from "vite-plus/test";
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
});
