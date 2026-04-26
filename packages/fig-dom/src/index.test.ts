import {
  createElement,
  Fragment,
  useBeforeLayout,
  useBeforePaint,
  useOnMount,
  useReactive,
  useState,
} from "@bgub/fig";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createRoot,
  DefaultLane,
  flushSync,
  render,
  runWithPriority,
} from "./index.ts";

class FakeText {
  parentNode: FakeElement | null = null;

  constructor(public nodeValue: string) {}

  get textContent(): string {
    return this.nodeValue;
  }
}

class FakeElement {
  childNodes: Array<FakeElement | FakeText> = [];
  attributes: Record<string, string> = {};
  listeners: Record<string, EventListener> = {};
  parentNode: FakeElement | null = null;
  style: Record<string, string> = {};

  constructor(public tagName: string) {}

  appendChild(node: FakeElement | FakeText): FakeElement | FakeText {
    node.parentNode?.removeChild(node);
    this.childNodes.push(node);
    node.parentNode = this;
    return node;
  }

  insertBefore(
    node: FakeElement | FakeText,
    child: FakeElement | FakeText | null,
  ): FakeElement | FakeText {
    if (child === null) {
      return this.appendChild(node);
    }

    node.parentNode?.removeChild(node);
    const index = this.childNodes.indexOf(child);

    if (index === -1) {
      this.childNodes.push(node);
    } else {
      this.childNodes.splice(index, 0, node);
    }

    node.parentNode = this;
    return node;
  }

  removeChild(node: FakeElement | FakeText): FakeElement | FakeText {
    const index = this.childNodes.indexOf(node);

    if (index !== -1) {
      this.childNodes.splice(index, 1);
    }

    node.parentNode = null;
    return node;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  removeAttribute(name: string): void {
    delete this.attributes[name];
  }

  addEventListener(name: string, listener: EventListener): void {
    this.listeners[name] = listener;
  }

  removeEventListener(name: string): void {
    delete this.listeners[name];
  }

  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join("");
  }
}

const delay = () => new Promise((resolve) => setTimeout(resolve, 20));
const documentValue = globalThis.document;

describe("@bgub/fig-dom", () => {
  beforeEach(() => {
    globalThis.document = {
      createElement: (tagName: string) => new FakeElement(tagName),
      createTextNode: (value: string) => new FakeText(value),
    } as unknown as Document;
  });

  afterEach(() => {
    globalThis.document = documentValue;
  });

  it("renders and updates host elements", async () => {
    const container = new FakeElement("root");

    render(
      createElement("div", { id: "first", className: "box" }, "Hello"),
      container as unknown as Element,
    );
    await delay();

    expect(container.textContent).toBe("Hello");
    expect(container.childNodes).toHaveLength(1);
    expect((container.childNodes[0] as FakeElement).attributes).toEqual({
      class: "box",
      id: "first",
    });

    render(
      createElement("div", { id: "second" }, "Goodbye"),
      container as unknown as Element,
    );
    await delay();

    expect(container.textContent).toBe("Goodbye");
    expect(container.childNodes).toHaveLength(1);
    expect((container.childNodes[0] as FakeElement).attributes).toEqual({
      id: "second",
    });
  });

  it("runs lazy state initializers only on mount", () => {
    let setCount: ((updater: (count: number) => number) => void) | null = null;
    let initializers = 0;

    function Counter() {
      const [count, set] = useState(() => {
        initializers += 1;
        return 0;
      });
      setCount = set;
      return createElement("button", null, "Count: ", count);
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement(Counter, null)));
    flushSync(() => setCount?.((count) => count + 1));

    expect(container.textContent).toBe("Count: 1");
    expect(initializers).toBe(1);
  });

  it("keeps state dispatches working across alternate tree swaps", () => {
    let setCount: ((updater: (count: number) => number) => void) | null = null;

    function Counter() {
      const [count, set] = useState(0);
      setCount = set;
      return createElement("span", null, count);
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement(Counter, null)));

    for (let expected = 1; expected <= 4; expected += 1) {
      flushSync(() => setCount?.((count) => count + 1));
      expect(container.textContent).toBe(String(expected));
    }
  });

  it("supports root unmounts", async () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    root.render(createElement("main", null, "Mounted"));
    await delay();
    expect(container.textContent).toBe("Mounted");

    root.unmount();
    await delay();
    expect(container.textContent).toBe("");
  });

  it("flushes sync work before returning", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement("main", null, "Now")));

    expect(container.textContent).toBe("Now");
  });

  it("rebases skipped lower-priority state updates", async () => {
    let setCount: ((updater: (count: number) => number) => void) | null = null;

    function Counter() {
      const [count, set] = useState(0);
      setCount = set;
      return createElement("span", null, count);
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement(Counter, null)));
    expect(container.textContent).toBe("0");

    runWithPriority(DefaultLane, () => {
      setCount?.((count) => count + 10);
    });
    flushSync(() => {
      setCount?.((count) => count + 1);
    });

    expect(container.textContent).toBe("1");

    await delay();
    expect(container.textContent).toBe("11");
  });

  it("runs effect phases in commit order", async () => {
    const calls: string[] = [];
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    function App() {
      useBeforeLayout(() => {
        calls.push(`before-layout:${container.textContent}`);
      });
      useBeforePaint(() => {
        calls.push(`before-paint:${container.textContent}`);
      });
      useReactive(() => {
        calls.push(`reactive:${container.textContent}`);
      });

      return createElement("main", null, "Committed");
    }

    flushSync(() => root.render(createElement(App, null)));
    expect(calls).toEqual(["before-layout:", "before-paint:Committed"]);

    await delay();
    expect(calls).toEqual([
      "before-layout:",
      "before-paint:Committed",
      "reactive:Committed",
    ]);
  });

  it("respects reactive deps and aborts changed effects", async () => {
    const calls: string[] = [];
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    function App({ value }: { value: number }) {
      useReactive(
        (signal) => {
          calls.push(`run:${value}`);
          signal.addEventListener("abort", () => calls.push(`abort:${value}`), {
            once: true,
          });
        },
        [value],
      );

      return createElement("main", null, value);
    }

    root.render(createElement(App, { value: 1 }));
    await delay();
    expect(calls).toEqual(["run:1"]);

    root.render(createElement(App, { value: 1 }));
    await delay();
    expect(calls).toEqual(["run:1"]);

    root.render(createElement(App, { value: 2 }));
    await delay();
    expect(calls).toEqual(["run:1", "abort:1", "run:2"]);

    root.unmount();
    await delay();
    expect(calls).toEqual(["run:1", "abort:1", "run:2", "abort:2"]);
  });

  it("flushes pending reactive effects before rendering new work", async () => {
    const calls: string[] = [];
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    function App({ value }: { value: number }) {
      useReactive(
        (signal) => {
          calls.push(`run:${value}`);
          signal.addEventListener("abort", () => calls.push(`abort:${value}`), {
            once: true,
          });
        },
        [value],
      );

      return createElement("main", null, value);
    }

    flushSync(() => root.render(createElement(App, { value: 1 })));
    expect(calls).toEqual([]);

    root.render(createElement(App, { value: 2 }));
    await delay();

    expect(calls).toEqual(["run:1", "abort:1", "run:2"]);
  });

  it("aborts before-layout and before-paint signals on deps changes and unmount", () => {
    const calls: string[] = [];
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    function App({ value }: { value: number }) {
      useBeforeLayout(
        (signal) => {
          calls.push(`layout:${value}`);
          signal.addEventListener(
            "abort",
            () => calls.push(`abort-layout:${value}`),
            { once: true },
          );
        },
        [value],
      );
      useBeforePaint(
        (signal) => {
          calls.push(`paint:${value}`);
          signal.addEventListener(
            "abort",
            () => calls.push(`abort-paint:${value}`),
            { once: true },
          );
        },
        [value],
      );

      return createElement("main", null, value);
    }

    flushSync(() => root.render(createElement(App, { value: 1 })));
    flushSync(() => root.render(createElement(App, { value: 2 })));
    flushSync(() => root.unmount());

    expect(calls).toEqual([
      "layout:1",
      "paint:1",
      "abort-layout:1",
      "layout:2",
      "abort-paint:1",
      "paint:2",
      "abort-layout:2",
      "abort-paint:2",
    ]);
  });

  it("runs useOnMount only once", async () => {
    const calls: string[] = [];
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    function App({ value }: { value: number }) {
      useOnMount((signal) => {
        calls.push(`mount:${value}`);
        signal.addEventListener("abort", () => calls.push(`abort:${value}`), {
          once: true,
        });
      });

      return createElement("main", null, value);
    }

    root.render(createElement(App, { value: 1 }));
    await delay();
    root.render(createElement(App, { value: 2 }));
    await delay();

    expect(calls).toEqual(["mount:1"]);

    root.unmount();
    await delay();
    expect(calls).toEqual(["mount:1", "abort:1"]);
  });

  it("aborts only the removed subtree effects", async () => {
    const calls: string[] = [];
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    function Child() {
      useReactive((signal) => {
        calls.push("child:run");
        signal.addEventListener("abort", () => calls.push("child:abort"), {
          once: true,
        });
      }, []);

      return createElement("span", null, "Child");
    }

    function App({ showChild }: { showChild: boolean }) {
      useReactive((signal) => {
        calls.push("parent:run");
        signal.addEventListener("abort", () => calls.push("parent:abort"), {
          once: true,
        });
      }, []);

      return createElement(
        "main",
        null,
        showChild ? createElement(Child) : null,
      );
    }

    root.render(createElement(App, { showChild: true }));
    await delay();
    expect(calls).toEqual(["parent:run", "child:run"]);

    root.render(createElement(App, { showChild: false }));
    await delay();
    expect(calls).toEqual(["parent:run", "child:run", "child:abort"]);

    root.unmount();
    await delay();
    expect(calls).toEqual([
      "parent:run",
      "child:run",
      "child:abort",
      "parent:abort",
    ]);
  });

  it("reruns only effects whose deps changed", async () => {
    const calls: string[] = [];
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    function App({ a, b }: { a: number; b: number }) {
      useReactive(
        (signal) => {
          calls.push(`a:${a}`);
          signal.addEventListener("abort", () => calls.push(`abort-a:${a}`), {
            once: true,
          });
        },
        [a],
      );
      useReactive(
        (signal) => {
          calls.push(`b:${b}`);
          signal.addEventListener("abort", () => calls.push(`abort-b:${b}`), {
            once: true,
          });
        },
        [b],
      );

      return createElement("main", null, a, b);
    }

    root.render(createElement(App, { a: 1, b: 1 }));
    await delay();
    root.render(createElement(App, { a: 2, b: 1 }));
    await delay();

    expect(calls).toEqual(["a:1", "b:1", "abort-a:1", "a:2"]);
  });

  it("moves keyed children during reconciliation", async () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    const first = createElement(
      "div",
      null,
      createElement("span", { key: "a" }, "A"),
      createElement("span", { key: "b" }, "B"),
    );
    const second = createElement(
      "div",
      null,
      createElement("span", { key: "b" }, "B"),
      createElement("span", { key: "a" }, "A"),
    );

    root.render(first);
    await delay();
    expect(container.textContent).toBe("AB");

    root.render(second);
    await delay();
    expect(container.textContent).toBe("BA");
  });

  it("inserts new children before stable siblings", async () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    root.render(
      createElement(
        "div",
        null,
        createElement("span", { key: "a" }, "A"),
        createElement("span", { key: "c" }, "C"),
      ),
    );
    await delay();
    expect(container.textContent).toBe("AC");

    root.render(
      createElement(
        "div",
        null,
        createElement("span", { key: "a" }, "A"),
        createElement("span", { key: "b" }, "B"),
        createElement("span", { key: "c" }, "C"),
      ),
    );
    await delay();
    expect(container.textContent).toBe("ABC");
  });

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

  it("updates DOM props without leaking stale attributes or listeners", () => {
    const firstClick = () => undefined;
    const secondClick = () => undefined;
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement("button", {
          className: "primary",
          disabled: true,
          onClick: firstClick,
          style: { color: "red" },
        }),
      ),
    );

    const button = container.childNodes[0] as FakeElement;
    expect(button.attributes).toEqual({ class: "primary", disabled: "true" });
    expect(button.listeners.click).toBe(firstClick);
    expect(button.style.color).toBe("red");

    flushSync(() =>
      root.render(
        createElement("button", {
          disabled: false,
          onClick: secondClick,
          style: { color: "blue" },
        }),
      ),
    );

    expect(button.attributes).toEqual({});
    expect(button.listeners.click).toBe(secondClick);
    expect(button.style.color).toBe("blue");

    flushSync(() => root.render(createElement("button", null)));

    expect(button.listeners.click).toBeUndefined();
  });
});
