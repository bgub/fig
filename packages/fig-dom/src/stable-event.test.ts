import {
  Activity,
  createElement,
  readPromise,
  Suspense,
  useBeforeLayout,
  useReactive,
  useStableEvent,
  useState,
} from "@bgub/fig";
import { describe, expect, it } from "vitest";
import { createRoot, flushSync } from "./index.ts";
import {
  waitForHostTurns,
  deferred,
  FakeElement,
  installFakeDocument,
} from "./test-utils.ts";

installFakeDocument();

describe("@bgub/fig-dom stable events", () => {
  it("publishes stable-event visibility when Suspense preserves and reveals a primary tree", async () => {
    const pending = deferred<string>();
    const signals: AbortSignal[] = [];
    const handlers: Array<() => void> = [];
    const errors: unknown[] = [];
    const fallbackBeforeLayoutAborted: boolean[] = [];

    function Actions() {
      const fire = useStableEvent((signal: AbortSignal) => {
        signals.push(signal);
      });
      useBeforeLayout(() => {
        handlers.push(fire);
      }, []);
      return createElement("button", null, "Task");
    }
    const actions = createElement(Actions, null);
    function Body({ loading }: { loading: boolean }) {
      if (loading) readPromise(pending.promise);
      return actions;
    }
    function Fallback() {
      useBeforeLayout(() => {
        handlers.at(-1)!();
        // Snapshot now: host mutations will abort the signal later anyway.
        fallbackBeforeLayoutAborted.push(signals.at(-1)!.aborted);
      }, []);
      return createElement("p", null, "Loading");
    }
    function App({ loading }: { loading: boolean }) {
      return createElement(
        Suspense,
        {
          fallback: createElement(Fallback, null),
        },
        createElement(Body, { loading }),
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element, {
      onUncaughtError: (error) => {
        errors.push(error);
      },
    });
    try {
      flushSync(() => root.render(createElement(App, { loading: false })));
      const button = container.childNodes[0];
      const fire = handlers.at(-1)!;
      fire();
      expect(signals.at(-1)?.aborted).toBe(false);

      flushSync(() => root.render(createElement(App, { loading: true })));
      expect(errors).toEqual([]);
      expect(fallbackBeforeLayoutAborted.length).toBeGreaterThan(0);
      expect(fallbackBeforeLayoutAborted.every(Boolean)).toBe(true);
      expect(signals[0].aborted).toBe(true);
      fire();
      expect(signals.at(-1)?.aborted).toBe(true);

      pending.resolve("ready");
      await waitForHostTurns();
      expect(errors).toEqual([]);
      expect(container.textContent).toBe("Task");
      expect(container.childNodes[0]).toBe(button);
      expect(handlers.at(-1)).toBe(fire);
      fire();
      expect(signals.at(-1)?.aborted).toBe(false);
    } finally {
      flushSync(() => root.unmount());
    }
    expect(signals.at(-1)?.aborted).toBe(true);
  });

  it("does not publish a handler from discarded work when a later sibling suspends", async () => {
    const pending = deferred<string>();
    const calls: Array<{ value: number; aborted: boolean }> = [];
    const handlers: Array<() => void> = [];

    function Actions({ value }: { value: number }) {
      const fire = useStableEvent((signal: AbortSignal) => {
        calls.push({ value, aborted: signal.aborted });
      });
      useBeforeLayout(() => {
        handlers.push(fire);
      }, []);
      return createElement("button", null, value);
    }
    function Gate({ loading }: { loading: boolean }) {
      if (loading) readPromise(pending.promise);
      return null;
    }
    function App({ loading, value }: { loading: boolean; value: number }) {
      return createElement(
        Suspense,
        {
          fallback: createElement("p", null, "Loading"),
        },
        createElement(Actions, { value }),
        createElement(Gate, { loading }),
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    try {
      flushSync(() =>
        root.render(createElement(App, { loading: false, value: 1 })),
      );
      const fire = handlers.at(-1)!;
      fire();
      flushSync(() =>
        root.render(createElement(App, { loading: true, value: 2 })),
      );
      fire();
      // A second capture must also publish the committed, hidden handler.
      flushSync(() =>
        root.render(createElement(App, { loading: true, value: 3 })),
      );
      fire();
      expect(calls).toEqual([
        { value: 1, aborted: false },
        { value: 1, aborted: true },
        { value: 1, aborted: true },
      ]);
      pending.resolve("ready");
      await waitForHostTurns();
      fire();
      expect(calls.at(-1)).toEqual({ value: 3, aborted: false });
    } finally {
      flushSync(() => root.unmount());
    }
  });

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
    await waitForHostTurns();
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
    await waitForHostTurns();
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
    await waitForHostTurns();
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
