import {
  createElement,
  lazy,
  readPromise,
  Suspense,
  transition,
  useReactive,
  useState,
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

describe("@bgub/fig-dom suspense", () => {
  it("suspends on pending promises and retries when they settle", async () => {
    let resolve: (value: string) => void = () => undefined;
    const promise = new Promise<string>((done) => {
      resolve = done;
    });

    function Message({ value }: { value: Promise<string> }) {
      return createElement("span", null, readPromise(value));
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement("main", null, "Stable")));
    flushSync(() => root.render(createElement(Message, { value: promise })));

    expect(container.textContent).toBe("Stable");

    resolve("Loaded");
    await delay();

    expect(container.textContent).toBe("Loaded");
  });

  it("renders Suspense fallback while promises are pending", async () => {
    const pending = deferred<string>();

    function Message({ value }: { value: Promise<string> }) {
      return createElement("span", null, readPromise(value));
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement("main", null, "Stable")));
    flushSync(() =>
      root.render(
        createElement(
          Suspense,
          { fallback: createElement("span", null, "Loading") },
          createElement(Message, { value: pending.promise }),
        ),
      ),
    );

    expect(container.textContent).toBe("Loading");

    pending.resolve("Loaded");
    await delay();

    expect(container.textContent).toBe("Loaded");
  });

  it("renders lazy components after their loader resolves", async () => {
    let loads = 0;

    function Message({ label }: { label: string }) {
      return createElement("span", null, label);
    }

    const pending = deferred<typeof Message>();
    const LazyMessage = lazy<{ label: string }>(() => {
      loads += 1;
      return pending.promise;
    });

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement(
          Suspense,
          { fallback: createElement("span", null, "Loading") },
          createElement(LazyMessage, { label: "Ready" }),
        ),
      ),
    );

    expect(container.textContent).toBe("Loading");
    expect(loads).toBe(1);

    pending.resolve(Message);
    await delay();

    expect(container.textContent).toBe("Ready");

    flushSync(() =>
      root.render(
        createElement(
          Suspense,
          { fallback: createElement("span", null, "Loading") },
          createElement(LazyMessage, { label: "Updated" }),
        ),
      ),
    );

    expect(container.textContent).toBe("Updated");
    expect(loads).toBe(1);
  });

  it("keeps revealed Suspense content visible while transitions suspend", async () => {
    const pending = deferred<string>();
    let setValue: ((value: Promise<string> | null) => void) | null = null;

    function Message({ value }: { value: Promise<string> | null }) {
      return createElement(
        "span",
        null,
        value === null ? "Ready" : readPromise(value),
      );
    }

    function App() {
      const [value, set] = useState<Promise<string> | null>(null);
      setValue = set;

      return createElement(
        Suspense,
        { fallback: createElement("span", null, "Loading") },
        createElement(Message, { value }),
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement(App, null)));
    expect(container.textContent).toBe("Ready");

    transition(() => {
      setValue?.(pending.promise);
    });
    await delay();

    expect(container.textContent).toBe("Ready");

    pending.resolve("Loaded");
    await delay();

    expect(container.textContent).toBe("Loaded");
  });

  it("renders Suspense fallback for initial transition suspension", async () => {
    const pending = deferred<string>();

    function Message() {
      return createElement("span", null, readPromise(pending.promise));
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    transition(() => {
      root.render(
        createElement(
          Suspense,
          { fallback: createElement("span", null, "Loading") },
          createElement(Message, null),
        ),
      );
    });
    await delay();

    expect(container.textContent).toBe("Loading");

    pending.resolve("Loaded");
    await delay();

    expect(container.textContent).toBe("Loaded");
  });

  it("uses the nearest Suspense boundary", async () => {
    const pending = deferred<string>();

    function Message() {
      return createElement("span", null, readPromise(pending.promise));
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement(
          Suspense,
          { fallback: createElement("span", null, "Outer") },
          createElement("span", null, "Header"),
          createElement(
            Suspense,
            { fallback: createElement("span", null, "Inner") },
            createElement(Message, null),
          ),
          createElement("span", null, "Footer"),
        ),
      ),
    );

    expect(container.textContent).toBe("HeaderInnerFooter");

    pending.resolve("Message");
    await delay();

    expect(container.textContent).toBe("HeaderMessageFooter");
  });

  it("bubbles fallback suspension to an outer Suspense boundary", async () => {
    const primary = deferred<string>();
    const fallback = deferred<string>();

    function PrimaryMessage() {
      return createElement("span", null, readPromise(primary.promise));
    }

    function FallbackMessage() {
      return createElement("span", null, readPromise(fallback.promise));
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement(
          Suspense,
          { fallback: createElement("span", null, "Outer") },
          createElement("span", null, "Header"),
          createElement(
            Suspense,
            { fallback: createElement(FallbackMessage, null) },
            createElement(PrimaryMessage, null),
          ),
          createElement("span", null, "Footer"),
        ),
      ),
    );

    expect(container.textContent).toBe("Outer");

    fallback.resolve("Inner fallback");
    await delay();

    expect(container.textContent).toBe("HeaderInner fallbackFooter");

    primary.resolve("Primary");
    await delay();

    expect(container.textContent).toBe("HeaderPrimaryFooter");
  });

  it("keeps showing fallback across multiple promise retries", async () => {
    const first = deferred<string>();
    const second = deferred<string>();

    function Message() {
      const firstValue = readPromise(first.promise);
      const secondValue = readPromise(second.promise);
      return createElement("span", null, firstValue, secondValue);
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement(
          Suspense,
          { fallback: createElement("span", null, "Loading") },
          createElement(Message, null),
        ),
      ),
    );

    expect(container.textContent).toBe("Loading");

    first.resolve("A");
    await delay();
    expect(container.textContent).toBe("Loading");

    second.resolve("B");
    await delay();
    expect(container.textContent).toBe("AB");
  });

  it("preserves state updates consumed by discarded Suspense primary work", async () => {
    const pending = deferred<string>();
    let setCount: ((updater: (count: number) => number) => void) | null = null;

    function Counter() {
      const [count, set] = useState(0);
      setCount = set;
      return createElement("span", null, count);
    }

    function Message({ value }: { value: Promise<string> | null }) {
      return createElement(
        "span",
        null,
        value === null ? "Ready" : readPromise(value),
      );
    }

    function App({ value }: { value: Promise<string> | null }) {
      return createElement(
        Suspense,
        { fallback: createElement("span", null, "Loading") },
        createElement(Counter, null),
        createElement(Message, { value }),
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement(App, { value: null })));
    expect(container.textContent).toBe("0Ready");

    flushSync(() => {
      setCount?.((count) => count + 1);
      root.render(createElement(App, { value: pending.promise }));
    });

    expect(container.textContent).toBe("Loading");

    pending.resolve("Loaded");
    await delay();

    expect(container.textContent).toBe("1Loaded");
  });

  it("does not retry Suspense boundaries after they are unmounted", async () => {
    const pending = deferred<string>();

    function Message() {
      return createElement("span", null, readPromise(pending.promise));
    }

    function App({ show }: { show: boolean }) {
      return createElement(
        "main",
        null,
        show
          ? createElement(
              Suspense,
              { fallback: createElement("span", null, "Loading") },
              createElement(Message, null),
            )
          : createElement("span", null, "Gone"),
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement(App, { show: true })));
    expect(container.textContent).toBe("Loading");

    flushSync(() => root.render(createElement(App, { show: false })));
    expect(container.textContent).toBe("Gone");

    pending.resolve("Loaded");
    await delay();

    expect(container.textContent).toBe("Gone");
  });

  it("reports rejected Suspense promises through the uncaught error path", async () => {
    const pending = deferred<string>();

    function Message() {
      return createElement("span", null, readPromise(pending.promise));
    }

    const container = new FakeElement("root");
    const uncaught: string[] = [];
    const root = createRoot(container as unknown as Element, {
      onUncaughtError(error) {
        uncaught.push((error as Error).message);
      },
    });
    const node = createElement(
      Suspense,
      { fallback: createElement("span", null, "Loading") },
      createElement(Message, null),
    );

    flushSync(() => root.render(node));
    expect(container.textContent).toBe("Loading");

    pending.reject(new Error("read failed"));
    await delay();

    expect(uncaught).toEqual(["read failed"]);
    expect(container.textContent).toBe("");

    flushSync(() => root.render(createElement("main", null, "Recovered")));
    expect(container.textContent).toBe("Recovered");
  });

  it("cleans up effects when Suspense switches between primary and fallback", async () => {
    const pending = deferred<string>();
    const calls: string[] = [];

    function Primary({ value }: { value: Promise<string> | null }) {
      useReactive((signal) => {
        calls.push("primary:run");
        signal.addEventListener("abort", () => calls.push("primary:abort"), {
          once: true,
        });
      }, []);

      return createElement(
        "span",
        null,
        value === null ? "Primary" : readPromise(value),
      );
    }

    function Fallback() {
      useReactive((signal) => {
        calls.push("fallback:run");
        signal.addEventListener("abort", () => calls.push("fallback:abort"), {
          once: true,
        });
      }, []);

      return createElement("span", null, "Loading");
    }

    function App({ value }: { value: Promise<string> | null }) {
      return createElement(
        Suspense,
        { fallback: createElement(Fallback, null) },
        createElement(Primary, { value }),
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    const primaryMount = ["primary:run", "primary:abort", "primary:run"];
    const fallbackMount = ["fallback:run", "fallback:abort", "fallback:run"];

    root.render(createElement(App, { value: null }));
    await delay();
    expect(container.textContent).toBe("Primary");
    expect(calls).toEqual(primaryMount);

    root.render(createElement(App, { value: pending.promise }));
    await delay();
    expect(container.textContent).toBe("Loading");
    expect(calls).toEqual([...primaryMount, "primary:abort", ...fallbackMount]);

    pending.resolve("Primary loaded");
    await delay();

    expect(container.textContent).toBe("Primary loaded");
    // The restored primary effect already strict-ran at first mount, so the
    // remount runs it once.
    expect(calls).toEqual([
      ...primaryMount,
      "primary:abort",
      ...fallbackMount,
      "fallback:abort",
      "primary:run",
    ]);
  });
});
