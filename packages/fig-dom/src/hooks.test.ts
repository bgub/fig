import {
  createElement,
  type FigNode,
  type Props,
  readPromise,
  Suspense,
  useCallback,
  useExternalStore,
  useId,
  useLaggedValue,
  useMemo,
  useReactive,
  useState,
  useTransition,
} from "@bgub/fig";
import { describe, expect, it } from "vite-plus/test";
import { createRoot, flushSync } from "./index.ts";
import {
  deferred,
  delay,
  FakeElement,
  installFakeDocument,
} from "./test-utils.ts";

installFakeDocument();

function expectHookDiagnostic<P extends Props>(
  Component: (props: P & { children?: FigNode }) => FigNode,
  initialProps: P,
  nextProps: P,
  message: string,
): void {
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element);

  flushSync(() => root.render(createElement(Component, initialProps)));

  expect(() => {
    flushSync(() => root.render(createElement(Component, nextProps)));
  }).toThrow(message);

  expect(container.textContent).toBe("");

  flushSync(() => root.render(createElement("main", null, "Recovered")));
}

function expectRenderDiagnostic(node: FigNode, message: string): void {
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element);

  flushSync(() => root.render(createElement("main", null, "Stable")));

  expect(() => {
    flushSync(() => root.render(node));
  }).toThrow(message);

  expect(container.textContent).toBe("");

  flushSync(() => root.render(createElement("main", null, "Recovered")));
  expect(container.textContent).toBe("Recovered");
}

describe("@bgub/fig-dom hooks", () => {
  // Tests run in development mode, where Fig renders components twice per
  // pass and discards the first (strict shadow pass), so render-phase
  // counters and pushes record both invocations.
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
    expect(initializers).toBe(2);

    flushSync(() => setCount?.((count) => count + 1));

    expect(container.textContent).toBe("Count: 1");
    expect(initializers).toBe(2);
  });

  it("memoizes computed values while deps are stable", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    const values: Array<{ doubled: number }> = [];
    let calculations = 0;

    function App({ label, value }: { label: string; value: number }) {
      const memoized = useMemo(() => {
        calculations += 1;
        return { doubled: value * 2 };
      }, [value]);
      values.push(memoized);
      return createElement("main", null, label, ":", memoized.doubled);
    }

    flushSync(() =>
      root.render(createElement(App, { label: "first", value: 2 })),
    );
    flushSync(() =>
      root.render(createElement(App, { label: "second", value: 2 })),
    );
    flushSync(() =>
      root.render(createElement(App, { label: "third", value: 3 })),
    );

    expect(container.textContent).toBe("third:6");
    expect(calculations).toBe(4);
    // Slots per pass: [first shadow, first real (committed), second shadow,
    // second real, third shadow, third real (committed)].
    expect(values).toHaveLength(6);
    expect(values[0]).not.toBe(values[1]);
    expect(values[2]).toBe(values[1]);
    expect(values[3]).toBe(values[1]);
    expect(values[5]).not.toBe(values[3]);
  });

  it("memoizes callback identities while deps are stable", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    const callbacks: Array<(next: string) => void> = [];
    const calls: string[] = [];

    function App({ label, value }: { label: string; value: string }) {
      const callback = useCallback(
        (next: string) => {
          calls.push(`${value}:${next}`);
        },
        [value],
      );
      callbacks.push(callback);
      return createElement("main", null, label);
    }

    flushSync(() =>
      root.render(createElement(App, { label: "first", value: "a" })),
    );
    flushSync(() =>
      root.render(createElement(App, { label: "second", value: "a" })),
    );
    flushSync(() =>
      root.render(createElement(App, { label: "third", value: "b" })),
    );

    // Slots per pass: [first shadow, first real (committed), second shadow,
    // second real, third shadow, third real (committed)].
    callbacks[1]("x");
    callbacks[5]("y");

    expect(container.textContent).toBe("third");
    expect(callbacks).toHaveLength(6);
    expect(callbacks[2]).toBe(callbacks[1]);
    expect(callbacks[3]).toBe(callbacks[1]);
    expect(callbacks[5]).not.toBe(callbacks[3]);
    expect(calls).toEqual(["a:x", "b:y"]);
  });

  it("generates stable prefixed ids", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element, {
      identifierPrefix: "app-",
    });
    const ids: string[] = [];

    function Field({ label }: { label: string }) {
      const id = useId();
      ids.push(id);

      return createElement(
        "label",
        { for: id },
        label,
        createElement("input", { id }),
      );
    }

    flushSync(() =>
      root.render(
        createElement(
          "main",
          null,
          createElement(Field, { label: "First" }),
          createElement(Field, { label: "Second" }),
        ),
      ),
    );
    flushSync(() =>
      root.render(
        createElement(
          "main",
          null,
          createElement(Field, { label: "First updated" }),
          createElement(Field, { label: "Second updated" }),
        ),
      ),
    );

    expect(ids).toEqual([
      "app-fig-0-0-0",
      "app-fig-0-0-0",
      "app-fig-0-1-0",
      "app-fig-0-1-0",
      "app-fig-0-0-0",
      "app-fig-0-0-0",
      "app-fig-0-1-0",
      "app-fig-0-1-0",
    ]);

    const main = container.childNodes[0] as FakeElement;
    const firstLabel = main.childNodes[0] as FakeElement;
    const secondLabel = main.childNodes[1] as FakeElement;
    const firstInput = firstLabel.childNodes[1] as FakeElement;
    const secondInput = secondLabel.childNodes[1] as FakeElement;

    expect(firstLabel.attributes.for).toBe("app-fig-0-0-0");
    expect(firstInput.attributes.id).toBe("app-fig-0-0-0");
    expect(secondLabel.attributes.for).toBe("app-fig-0-1-0");
    expect(secondInput.attributes.id).toBe("app-fig-0-1-0");
  });

  it("tracks pending transition work until suspended content resolves", async () => {
    const pending = deferred<string>();
    let start: ((callback: () => void) => void) | null = null;
    let show: ((value: Promise<string>) => void) | null = null;

    function Message({ value }: { value: Promise<string> | null }) {
      return value === null ? "Ready" : readPromise(value);
    }

    function App() {
      const [value, setValue] = useState<Promise<string> | null>(null);
      const [isPending, startTransition] = useTransition();
      start = startTransition;
      show = setValue;

      return createElement(
        "main",
        null,
        isPending ? "Pending " : "Idle ",
        createElement(
          Suspense,
          { fallback: "Loading" },
          createElement(Message, { value }),
        ),
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement(App, null)));
    expect(container.textContent).toBe("Idle Ready");

    const startTransition = start as ((callback: () => void) => void) | null;
    const showValue = show as ((value: Promise<string>) => void) | null;
    if (startTransition === null || showValue === null) {
      throw new Error("Expected transition controls.");
    }
    startTransition(() => showValue(pending.promise));
    await delay();

    expect(container.textContent).toBe("Pending Ready");

    pending.resolve("Loaded");
    await delay();

    expect(container.textContent).toBe("Idle Loaded");
  });

  it("lags urgent value updates until deferred work catches up", async () => {
    let setValue: ((value: string) => void) | null = null;

    function App() {
      const [value, set] = useState("Ready");
      const lagged = useLaggedValue(value, "Boot");
      setValue = set;
      return createElement("main", null, lagged);
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement(App, null)));
    expect(container.textContent).toBe("Boot");

    await delay();
    expect(container.textContent).toBe("Ready");

    flushSync(() => setValue?.("Fresh"));
    expect(container.textContent).toBe("Ready");

    await delay();
    expect(container.textContent).toBe("Fresh");
  });

  it("uses the latest urgent value when multiple lagged updates are pending", async () => {
    let setValue: ((value: string) => void) | null = null;

    function App() {
      const [value, set] = useState("A");
      const lagged = useLaggedValue(value);
      setValue = set;
      return createElement("main", null, lagged);
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement(App, null)));
    expect(container.textContent).toBe("A");

    flushSync(() => setValue?.("B"));
    expect(container.textContent).toBe("A");

    flushSync(() => setValue?.("C"));
    expect(container.textContent).toBe("A");

    await delay();
    expect(container.textContent).toBe("C");
  });

  it("keeps revealed Suspense content visible while lagged work suspends", async () => {
    const pending = deferred<string>();
    let show: ((value: Promise<string>) => void) | null = null;

    function Message({ value }: { value: Promise<string> | null }) {
      const lagged = useLaggedValue(value);
      return lagged === null ? "Ready" : readPromise(lagged);
    }

    function App() {
      const [value, set] = useState<Promise<string> | null>(null);
      show = set;

      return createElement(
        "main",
        null,
        createElement(
          Suspense,
          { fallback: "Loading" },
          createElement(Message, { value }),
        ),
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement(App, null)));
    expect(container.textContent).toBe("Ready");

    flushSync(() => show?.(pending.promise));
    expect(container.textContent).toBe("Ready");

    await delay();
    expect(container.textContent).toBe("Ready");

    pending.resolve("Loaded");
    await delay();
    expect(container.textContent).toBe("Loaded");
  });

  it("does not lag transition updates", async () => {
    let start: ((callback: () => void) => void) | null = null;
    let setValue: ((value: string) => void) | null = null;

    function App() {
      const [value, set] = useState("A");
      const [, startTransition] = useTransition();
      const lagged = useLaggedValue(value);
      setValue = set;
      start = startTransition;
      return createElement("main", null, lagged);
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement(App, null)));
    expect(container.textContent).toBe("A");

    const startTransition = start as ((callback: () => void) => void) | null;
    const set = setValue as ((value: string) => void) | null;
    if (startTransition === null || set === null) {
      throw new Error("Expected transition controls.");
    }

    startTransition(() => set("B"));
    await delay();

    expect(container.textContent).toBe("B");
  });

  it("subscribes to external stores and updates from emitted snapshots", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    const listeners = new Set<() => void>();
    let value = "Initial";

    const subscribe = (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    };

    function App() {
      const snapshot = useExternalStore(subscribe, () => value);
      return createElement("main", null, snapshot);
    }

    flushSync(() => root.render(createElement(App, null)));
    expect(container.textContent).toBe("Initial");

    value = "Updated";
    flushSync(() => {
      for (const listener of listeners) listener();
    });

    expect(container.textContent).toBe("Updated");
  });

  it("unsubscribes from external stores on unmount", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    let unsubscribeCalls = 0;

    function App() {
      const snapshot = useExternalStore(
        () => {
          return () => {
            unsubscribeCalls += 1;
          };
        },
        () => "Mounted",
      );
      return createElement("main", null, snapshot);
    }

    flushSync(() => root.render(createElement(App, null)));
    flushSync(() => root.unmount());

    expect(unsubscribeCalls).toBe(1);
  });

  it("throws on render-phase state updates without committing failed work", () => {
    function Broken() {
      const [, setValue] = useState(0);
      setValue(1);
      return createElement("main", null, "Broken");
    }

    expectRenderDiagnostic(
      createElement(Broken, null),
      "State updates are not allowed while rendering a component.",
    );
  });

  it("throws when components render fewer hooks", () => {
    function App({ skip }: { skip?: boolean }) {
      useState("first");
      if (!skip) useState("second");
      return createElement("main", null, "Stable");
    }

    expectHookDiagnostic(
      App,
      { skip: false },
      { skip: true },
      "Rendered fewer hooks than during the previous render.",
    );
  });

  it("throws when components render more hooks", () => {
    function App({ extra }: { extra?: boolean }) {
      if (extra) useState("first");
      return createElement("main", null, "Stable");
    }

    expectHookDiagnostic(
      App,
      { extra: false },
      { extra: true },
      "Rendered more hooks than during the previous render.",
    );
  });

  it("throws when hook order changes", () => {
    function App({ effect }: { effect?: boolean }) {
      if (effect) useReactive(() => undefined, []);
      else useState("first");
      return createElement("main", null, "Stable");
    }

    expectHookDiagnostic(
      App,
      { effect: false },
      { effect: true },
      "Hook order changed: expected state, received reactive.",
    );
  });
});
