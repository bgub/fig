import { createElement, useState } from "@bgub/fig";
import { runWithEventPriority } from "@bgub/fig-reconciler";
import { describe, expect, it } from "vitest";
import { createRoot, flushSync, on } from "./index.ts";
import {
  waitForHostTurns,
  FakeElement,
  installFakeDocument,
} from "./test-utils.ts";

installFakeDocument();

describe("@bgub/fig-dom scheduling", () => {
  it("batches same-tick updates automatically, without an explicit batch", async () => {
    let renders = 0;
    let setCount: (updater: (count: number) => number) => void = () =>
      undefined;

    function Counter() {
      renders += 1;
      const [count, set] = useState(0);
      setCount = set;
      return createElement("span", null, count);
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement(Counter, null)));
    // Each pass renders twice in development (strict shadow pass).
    expect(renders).toBe(2);

    // No batchedUpdates wrapper: same-tick updates from any source coalesce
    // into one scheduled render pass (there is no legacy opt-in API).
    setCount((count) => count + 1);
    setCount((count) => count + 1);
    expect(container.textContent).toBe("0");

    await waitForHostTurns();
    expect(container.textContent).toBe("2");
    expect(renders).toBe(4);
  });

  it("batches updates inside DOM event handlers", async () => {
    let renders = 0;

    function Counter() {
      renders += 1;
      const [count, setCount] = useState(0);
      return createElement(
        "button",
        {
          mix: [
            on("click", () => {
              setCount((value) => value + 1);
              setCount((value) => value + 1);
              expect(container.textContent).toBe("0");
            }),
          ],
        },
        count,
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement(Counter, null)));

    const button = container.childNodes[0] as FakeElement;
    button.dispatch("click");

    expect(renders).toBe(2);

    await waitForHostTurns();
    expect(container.textContent).toBe("2");
    expect(renders).toBe(4);
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

    runWithEventPriority("default", () => {
      setCount?.((count) => count + 10);
    });
    flushSync(() => {
      setCount?.((count) => count + 1);
    });

    expect(container.textContent).toBe("1");

    await waitForHostTurns();
    expect(container.textContent).toBe("11");
  });

  it("clears processed lanes so stable siblings can bail out", () => {
    let setLeft: ((updater: (count: number) => number) => void) | null = null;
    let setRight: ((updater: (count: number) => number) => void) | null = null;
    let leftRenders = 0;
    let rightRenders = 0;

    function Left() {
      leftRenders += 1;
      const [, set] = useState(0);
      setLeft = set;
      return createElement("span", null, "L");
    }

    function Right() {
      rightRenders += 1;
      const [, set] = useState(0);
      setRight = set;
      return createElement("span", null, "R");
    }

    const left = createElement(Left, null);
    const right = createElement(Right, null);

    function App() {
      return createElement("main", null, left, right);
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement(App, null)));
    expect([leftRenders, rightRenders]).toEqual([2, 2]);

    flushSync(() => setLeft?.((count) => count + 1));
    expect([leftRenders, rightRenders]).toEqual([4, 2]);

    flushSync(() => setRight?.((count) => count + 1));
    expect([leftRenders, rightRenders]).toEqual([4, 4]);
  });
});
