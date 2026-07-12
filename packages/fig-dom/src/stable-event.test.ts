import {
  Activity,
  createElement,
  useBeforeLayout,
  useReactive,
  useStableEvent,
  useState,
} from "@bgub/fig";
import { describe, expect, it } from "vitest";
import { createRoot, flushSync } from "./index.ts";
import { delay, FakeElement, installFakeDocument } from "./test-utils.ts";

installFakeDocument();

describe("@bgub/fig-dom stable events", () => {
  it("returns a stable handler that reads the latest committed render", async () => {
    const calls: string[] = [];
    const handlers: Array<(suffix: string) => void> = [];
    let emit: ((suffix: string) => void) | null = null;
    let setCount: ((updater: (count: number) => number) => void) | null = null;

    function App() {
      const [count, set] = useState(0);
      setCount = set;
      const onPing = useStableEvent((suffix: string, _signal: AbortSignal) => {
        calls.push(`${count}:${suffix}`);
      });
      handlers.push(onPing);
      useReactive(() => {
        emit = onPing;
      }, []);
      return createElement("span", null, count);
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    flushSync(() => root.render(createElement(App, null)));
    await delay();
    const fire = emit as unknown as (suffix: string) => void;

    fire("a");
    flushSync(() => setCount?.((count) => count + 1));
    fire("b");

    expect(calls).toEqual(["0:a", "1:b"]);
    // The mount shadow pass creates a discarded instance; every committed
    // render returns the same handler.
    expect(handlers).toHaveLength(4);
    expect(new Set(handlers.slice(1)).size).toBe(1);
    expect(container.textContent).toBe("1");
  });

  it("aborts the previous invocation's signal on re-entry and on unmount", async () => {
    const signals: AbortSignal[] = [];
    let emit: (() => void) | null = null;

    function App() {
      const onPing = useStableEvent((signal: AbortSignal) => {
        signals.push(signal);
      });
      useReactive(() => {
        emit = onPing;
      }, []);
      return createElement("span", null, "app");
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    flushSync(() => root.render(createElement(App, null)));
    await delay();
    const fire = emit as unknown as () => void;

    fire();
    expect(signals[0].aborted).toBe(false);

    fire();
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);

    flushSync(() => root.unmount());
    expect(signals[1].aborted).toBe(true);

    // Calls after unmount still run the last committed handler, but their
    // signal arrives already aborted.
    fire();
    expect(signals).toHaveLength(3);
    expect(signals[2].aborted).toBe(true);
  });

  it("keeps hidden stable event calls aborted across unrelated commits", () => {
    const signals: AbortSignal[] = [];
    let fire: (() => void) | null = null;
    let bump: (() => void) | null = null;

    function HiddenChild() {
      fire = useStableEvent((signal: AbortSignal) => {
        signals.push(signal);
      });
      return createElement("span", null, "hidden");
    }

    function OutsideCounter() {
      const [count, setCount] = useState(0);
      bump = () => setCount((value) => value + 1);
      return createElement("span", null, count);
    }

    function App() {
      return createElement(
        "main",
        null,
        createElement(OutsideCounter, null),
        createElement(
          Activity,
          { mode: "hidden" },
          createElement(HiddenChild, null),
        ),
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement(App, null)));
    const fireHidden = fire as unknown as () => void;
    const bumpOutside = bump as unknown as () => void;

    fireHidden();
    expect(signals.at(-1)?.aborted).toBe(true);

    flushSync(() => bumpOutside());
    fireHidden();
    expect(signals.at(-1)?.aborted).toBe(true);
  });

  it("accepts handlers that take args but omit the trailing signal", async () => {
    const calls: string[] = [];
    let emit: ((name: string) => void) | null = null;

    function App() {
      const onPing = useStableEvent((name: string) => {
        calls.push(name);
      });
      useReactive(() => {
        emit = onPing;
      }, []);
      return createElement("span", null, "app");
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    flushSync(() => root.render(createElement(App, null)));
    await delay();
    const fire = emit as unknown as (name: string) => void;

    fire("x");
    fire("y");

    expect(calls).toEqual(["x", "y"]);
  });

  it("throws when a stable event is called during render", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    function App() {
      const onPing = useStableEvent((_signal: AbortSignal) => undefined);
      onPing();
      return null;
    }

    expect(() =>
      flushSync(() => root.render(createElement(App, null))),
    ).toThrow("Stable events cannot be called while rendering a component.");
  });

  it("publishes the new handler before before-layout effects run", () => {
    const seen: number[] = [];

    function App({ value }: { value: number }) {
      const read = useStableEvent((_signal: AbortSignal) => value);
      useBeforeLayout(() => {
        seen.push(read());
      }, [value]);
      return createElement("span", null, value);
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement(App, { value: 1 })));
    // First-time effects strict-run twice in development.
    expect(seen).toEqual([1, 1]);

    flushSync(() => root.render(createElement(App, { value: 2 })));
    expect(seen).toEqual([1, 1, 2]);
  });
});
