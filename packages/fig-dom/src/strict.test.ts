import { createElement, useReactive, useState } from "@bgub/fig";
import { describe, expect, it } from "vitest";
import { createRoot, flushSync } from "./index.ts";
import { delay, FakeElement, installFakeDocument } from "./test-utils.ts";

installFakeDocument();

// Fig has no StrictMode component: development builds always strict-render.
// Each render pass invokes the component twice and discards the first
// (shadow) pass, and first-time effects and binds run, abort, and run again
// so code that ignores its AbortSignal surfaces immediately.
describe("@bgub/fig-dom strict development semantics", () => {
  it("renders twice per pass and commits only the second result", () => {
    const rendered: object[] = [];
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    function App() {
      rendered.push({});
      return createElement("span", null, "Once");
    }

    flushSync(() => root.render(createElement(App, null)));

    expect(rendered).toHaveLength(2);
    expect(container.childNodes).toHaveLength(1);
    expect(container.textContent).toBe("Once");
  });

  it("double-invokes state updaters without double-applying them", () => {
    let updaterCalls = 0;
    let setCount: ((updater: (count: number) => number) => void) | null = null;
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    function Counter() {
      const [count, set] = useState(0);
      setCount = set;
      return createElement("span", null, count);
    }

    flushSync(() => root.render(createElement(Counter, null)));
    flushSync(() =>
      setCount?.((count) => {
        updaterCalls += 1;
        return count + 1;
      }),
    );

    expect(updaterCalls).toBe(2);
    expect(container.textContent).toBe("1");
  });

  it("aborts the first effect signal and leaves the re-run signal live", async () => {
    const signals: AbortSignal[] = [];
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    function App({ value }: { value: number }) {
      useReactive(
        (signal) => {
          signals.push(signal);
        },
        [value],
      );
      return createElement("span", null, value);
    }

    root.render(createElement(App, { value: 1 }));
    await delay();

    expect(signals).toHaveLength(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);

    root.render(createElement(App, { value: 2 }));
    await delay();

    // Deps-change reruns stay single; only first-time effects strict-run.
    expect(signals).toHaveLength(3);
    expect(signals[1]?.aborted).toBe(true);
    expect(signals[2]?.aborted).toBe(false);
  });

  it("aborts the first bind signal and leaves the re-run signal live", () => {
    const signals: AbortSignal[] = [];
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    function App() {
      return createElement("input", {
        bind: (_node: Element, signal: AbortSignal) => {
          signals.push(signal);
        },
      });
    }

    flushSync(() => root.render(createElement(App, null)));

    expect(signals).toHaveLength(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });

  it("settles effects that flush nested renders during their create", async () => {
    let effectRuns = 0;
    let setTick: ((updater: (tick: number) => number) => void) | null = null;
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    function App() {
      const [tick, set] = useState(0);
      setTick = set;
      useReactive(() => {
        effectRuns += 1;
        setTick?.((value) => value + 1);
        flushSync(() => undefined);
      }, []);
      return createElement("span", null, tick);
    }

    root.render(createElement(App, null));
    await delay();
    const settledRuns = effectRuns;

    flushSync(() => setTick?.((value) => value + 1));
    await delay();

    // The nested flush re-renders while the strict cycle is mid-flight; the
    // once-per-lifetime marker keeps the cycle from re-entering forever.
    expect(settledRuns).toBeLessThanOrEqual(3);
    expect(effectRuns).toBe(settledRuns);
    expect(container.textContent).toBe(String(settledRuns + 1));
  });
});
