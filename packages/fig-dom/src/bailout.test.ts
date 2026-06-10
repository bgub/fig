import {
  createContext,
  createElement,
  readContext,
  useReactive,
  useState,
} from "@bgub/fig";
import { describe, expect, it } from "vite-plus/test";
import { createRoot, flushSync } from "./index.ts";
import { delay, FakeElement, installFakeDocument } from "./test-utils.ts";

installFakeDocument();

// Render counts double at mount in development (strict shadow pass).
describe("@bgub/fig-dom subtree bailout", () => {
  it("does not re-render ancestors or siblings when a leaf updates", () => {
    let appRenders = 0;
    let siblingRenders = 0;
    let setCount: ((updater: (count: number) => number) => void) | null = null;

    function Sibling() {
      siblingRenders += 1;
      return createElement("span", null, "S");
    }

    function Counter() {
      const [count, set] = useState(0);
      setCount = set;
      return createElement("span", null, count);
    }

    function App() {
      appRenders += 1;
      return createElement(
        "main",
        null,
        createElement(Sibling, null),
        createElement(Counter, null),
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    flushSync(() => root.render(createElement(App, null)));
    expect([appRenders, siblingRenders]).toEqual([2, 2]);

    flushSync(() => setCount?.((count) => count + 1));

    expect([appRenders, siblingRenders]).toEqual([2, 2]);
    expect(container.textContent).toBe("S1");
  });

  it("keeps adopted subtrees updatable", () => {
    let leftRenders = 0;
    let rightRenders = 0;
    let setLeft: ((updater: (count: number) => number) => void) | null = null;
    let setRight: ((updater: (count: number) => number) => void) | null = null;

    function Left() {
      leftRenders += 1;
      const [count, set] = useState(0);
      setLeft = set;
      return createElement("span", null, "L", count);
    }

    function Right() {
      rightRenders += 1;
      const [count, set] = useState(0);
      setRight = set;
      return createElement("span", null, "R", count);
    }

    function App() {
      return createElement(
        "main",
        null,
        createElement(Left, null),
        createElement(Right, null),
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    flushSync(() => root.render(createElement(App, null)));

    // Right's subtree is adopted twice while Left updates.
    flushSync(() => setLeft?.((count) => count + 1));
    flushSync(() => setLeft?.((count) => count + 1));
    expect([leftRenders, rightRenders]).toEqual([6, 2]);
    expect(container.textContent).toBe("L2R0");

    // An update inside the twice-adopted subtree still lands.
    flushSync(() => setRight?.((count) => count + 1));
    expect([leftRenders, rightRenders]).toEqual([6, 4]);
    expect(container.textContent).toBe("L2R1");
  });

  it("aborts effects inside adopted subtrees when an ancestor unmounts", async () => {
    const calls: string[] = [];
    let setCount: ((updater: (count: number) => number) => void) | null = null;

    function Child() {
      useReactive((signal) => {
        calls.push("run");
        signal.addEventListener("abort", () => calls.push("abort"), {
          once: true,
        });
      }, []);
      return createElement("span", null, "child");
    }

    function Wrapper() {
      return createElement("section", null, createElement(Child, null));
    }

    function App({ show }: { show: boolean }) {
      const [count, set] = useState(0);
      setCount = set;
      return createElement(
        "main",
        null,
        createElement("b", null, count),
        show ? createElement(Wrapper, null) : null,
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    root.render(createElement(App, { show: true }));
    await delay();
    expect(calls).toEqual(["run", "abort", "run"]);

    // Adopt the Wrapper subtree, then unmount it through a prop change.
    flushSync(() => setCount?.((count) => count + 1));
    flushSync(() => root.render(createElement(App, { show: false })));
    await delay();

    expect(calls).toEqual(["run", "abort", "run", "abort"]);
    expect(container.textContent).toBe("1");
  });

  it("re-renders context consumers inside previously adopted subtrees", () => {
    const Theme = createContext("light");
    let consumerRenders = 0;
    let setTick: ((updater: (tick: number) => number) => void) | null = null;
    let setTheme: ((theme: string) => void) | null = null;

    function Consumer() {
      consumerRenders += 1;
      return createElement("span", null, readContext(Theme));
    }

    const consumerTree = createElement(
      "section",
      null,
      createElement(Consumer, null),
    );

    function App() {
      const [theme, setThemeState] = useState("light");
      const [tick, setTickState] = useState(0);
      setTheme = setThemeState;
      setTick = setTickState;
      return createElement(
        Theme,
        { value: theme },
        createElement("b", null, tick),
        consumerTree,
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    flushSync(() => root.render(createElement(App, null)));
    expect(consumerRenders).toBe(2);

    // The consumer subtree is adopted while unrelated state updates.
    flushSync(() => setTick?.((tick) => tick + 1));
    expect(consumerRenders).toBe(2);

    // A provider change reaches the consumer through the adopted region.
    flushSync(() => setTheme?.("dark"));
    expect(consumerRenders).toBe(4);
    expect(container.textContent).toBe("1dark");
  });

  it("places new siblings correctly before adopted subtrees", () => {
    let setShow: ((updater: (show: boolean) => boolean) => void) | null = null;

    function Tail() {
      return createElement("span", null, "tail");
    }

    const tail = createElement("section", null, createElement(Tail, null));

    function App() {
      const [show, set] = useState(false);
      setShow = set;
      return createElement(
        "main",
        null,
        show ? createElement("span", null, "new") : null,
        tail,
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    flushSync(() => root.render(createElement(App, null)));
    expect(container.textContent).toBe("tail");

    flushSync(() => setShow?.(() => true));
    expect(container.textContent).toBe("newtail");
  });
});
