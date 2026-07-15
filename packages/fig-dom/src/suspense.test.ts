import {
  createElement,
  ErrorBoundary,
  lazy,
  readPromise,
  Suspense,
  transition,
  useReactive,
  useState,
} from "@bgub/fig";
import { describe, expect, it } from "vitest";
import { createRoot, flushSync, on } from "./index.ts";
import {
  deferred,
  waitForHostTurns,
  FakeElement,
  installFakeDocument,
} from "./test-utils.ts";

installFakeDocument();

function display(node: FakeElement): string {
  return node.style.display ?? "";
}

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
    await waitForHostTurns();

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
    await waitForHostTurns();

    expect(container.textContent).toBe("Loaded");
  });

  it("renders lazy components after their loader resolves", async () => {
    let loads = 0;

    function Message({ label }: { label: string }) {
      return createElement("span", null, label);
    }

    const pending = deferred<typeof Message>();
    const LazyMessage = lazy(() => {
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
    await waitForHostTurns();

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

  it("surfaces lazy loader rejections until an explicit retry", async () => {
    let loads = 0;
    let setAttempt: ((attempt: number) => void) | null = null;

    function Message({ label }: { label: string }) {
      return createElement("span", null, label);
    }

    const first = deferred<typeof Message>();
    const second = deferred<typeof Message>();
    const LazyMessage = lazy(() => {
      loads += 1;
      return loads === 1 ? first.promise : second.promise;
    });

    function Content({ attempt }: { attempt: number }) {
      return createElement(
        ErrorBoundary,
        {
          key: attempt,
          fallback: createElement("span", null, "Crashed"),
        },
        createElement(
          Suspense,
          { fallback: createElement("span", null, "Loading") },
          createElement(LazyMessage, { label: "Ready" }),
        ),
      );
    }

    function App() {
      const [attempt, set] = useState(0);
      setAttempt = set;
      return createElement(Content, { attempt });
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement(App, null)));
    expect(container.textContent).toBe("Loading");
    expect(loads).toBe(1);

    first.reject(new Error("chunk failed"));
    await waitForHostTurns();
    expect(container.textContent).toBe("Crashed");
    expect(loads).toBe(1);

    flushSync(() => setAttempt?.(1));
    expect(container.textContent).toBe("Loading");
    expect(loads).toBe(2);

    second.resolve(Message);
    await waitForHostTurns();
    expect(container.textContent).toBe("Ready");
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
    await waitForHostTurns();

    expect(container.textContent).toBe("Ready");

    pending.resolve("Loaded");
    await waitForHostTurns();

    expect(container.textContent).toBe("Loaded");
  });

  it("keeps post-await transition helper updates in the transition lane", async () => {
    const gate = deferred<void>();
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

    void transition(async () => {
      await gate.promise;
      setValue?.(pending.promise);
    });
    await waitForHostTurns();
    expect(container.textContent).toBe("Ready");

    gate.resolve(undefined);
    await waitForHostTurns();
    expect(container.textContent).toBe("Ready");

    pending.resolve("Loaded");
    await waitForHostTurns();
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
    await waitForHostTurns();

    expect(container.textContent).toBe("Loading");

    pending.resolve("Loaded");
    await waitForHostTurns();

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
    await waitForHostTurns();

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
    await waitForHostTurns();

    expect(container.textContent).toBe("HeaderInner fallbackFooter");

    primary.resolve("Primary");
    await waitForHostTurns();

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
    await waitForHostTurns();
    expect(container.textContent).toBe("Loading");

    second.resolve("B");
    await waitForHostTurns();
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

    const [count, ready, fallback] = container.childNodes as FakeElement[];
    expect(display(count)).toBe("none");
    expect(display(ready)).toBe("none");
    expect(display(fallback)).toBe("");
    expect(fallback.textContent).toBe("Loading");

    pending.resolve("Loaded");
    await waitForHostTurns();

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
    await waitForHostTurns();

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
    await waitForHostTurns();

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
    await waitForHostTurns();
    expect(container.textContent).toBe("Primary");
    expect(calls).toEqual(primaryMount);

    root.render(createElement(App, { value: pending.promise }));
    await waitForHostTurns();
    const [primary, fallback] = container.childNodes as FakeElement[];
    expect(display(primary)).toBe("none");
    expect(display(fallback)).toBe("");
    expect(fallback.textContent).toBe("Loading");
    expect(calls).toEqual([...primaryMount, "primary:abort", ...fallbackMount]);

    pending.resolve("Primary loaded");
    await waitForHostTurns();

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

describe("@bgub/fig-dom suspense reveal preserves non-suspending siblings", () => {
  function makeSlow(gate: Promise<string>) {
    return function Slow() {
      return readPromise(gate);
    };
  }

  it("keeps a host sibling rendered before the suspending child", async () => {
    const gate = deferred<string>();
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement(
          Suspense,
          { fallback: createElement("i", null, "load") },
          createElement(
            "div",
            null,
            createElement("p", null, "P"),
            createElement(makeSlow(gate.promise), null),
          ),
        ),
      ),
    );
    expect(container.textContent).toBe("load");

    gate.resolve("DONE");
    await waitForHostTurns();

    expect(container.textContent).toBe("PDONE");
  });

  it("keeps a host sibling rendered after the suspending child", async () => {
    const gate = deferred<string>();
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement(
          Suspense,
          { fallback: createElement("i", null, "load") },
          createElement(
            "div",
            null,
            createElement(makeSlow(gate.promise), null),
            createElement("p", null, "P"),
          ),
        ),
      ),
    );
    expect(container.textContent).toBe("load");

    gate.resolve("DONE");
    await waitForHostTurns();

    expect(container.textContent).toBe("DONEP");
  });

  it("keeps multiple non-suspending siblings around a suspending child", async () => {
    const gate = deferred<string>();
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement(
          Suspense,
          { fallback: createElement("i", null, "load") },
          createElement(
            "div",
            null,
            createElement("p", null, "A"),
            createElement(makeSlow(gate.promise), null),
            createElement("p", null, "B"),
            createElement("span", null, "C"),
          ),
        ),
      ),
    );
    expect(container.textContent).toBe("load");

    gate.resolve("X");
    await waitForHostTurns();

    expect(container.textContent).toBe("AXBC");
  });

  it("assembles nested host wrappers around a deeper suspending child", async () => {
    const gate = deferred<string>();
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement(
          Suspense,
          { fallback: createElement("i", null, "load") },
          createElement(
            "div",
            null,
            createElement(
              "section",
              null,
              createElement("p", null, "P"),
              createElement(makeSlow(gate.promise), null),
            ),
          ),
        ),
      ),
    );
    expect(container.textContent).toBe("load");

    gate.resolve("DONE");
    await waitForHostTurns();

    const div = container.childNodes[0] as FakeElement;
    const section = div.childNodes[0] as FakeElement;
    // The whole nested subtree is assembled and inserted once on reveal.
    expect(section.childNodes.map((child) => child.textContent)).toEqual([
      "P",
      "DONE",
    ]);
    expect(container.textContent).toBe("PDONE");
  });

  it("keeps a non-suspending component sibling", async () => {
    const gate = deferred<string>();

    function Stable() {
      return createElement("p", null, "stable");
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement(
          Suspense,
          { fallback: createElement("i", null, "load") },
          createElement(
            "div",
            null,
            createElement(Stable, null),
            createElement(makeSlow(gate.promise), null),
          ),
        ),
      ),
    );
    expect(container.textContent).toBe("load");

    gate.resolve("DONE");
    await waitForHostTurns();

    expect(container.textContent).toBe("stableDONE");
  });

  it("keeps siblings across a re-suspension after a committed reveal", async () => {
    let setGate: ((value: Promise<string>) => void) | null = null;
    const first = deferred<string>();

    function App({ initial }: { initial: Promise<string> }) {
      const [gate, set] = useState(initial);
      setGate = set;
      return createElement(
        Suspense,
        { fallback: createElement("i", null, "load") },
        createElement(
          "div",
          null,
          createElement("p", null, "P"),
          createElement(makeSlow(gate), null),
        ),
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(createElement(App, { initial: first.promise })),
    );
    expect(container.textContent).toBe("load");

    first.resolve("ONE");
    await waitForHostTurns();
    expect(container.textContent).toBe("PONE");

    // Update the suspending child to a fresh pending promise: it re-suspends,
    // the boundary shows the fallback again, then reveals a second time.
    const second = deferred<string>();
    flushSync(() => setGate?.(second.promise));
    const [primary, fallback] = container.childNodes as FakeElement[];
    expect(display(primary)).toBe("none");
    expect(display(fallback)).toBe("");
    expect(fallback.textContent).toBe("load");

    second.resolve("TWO");
    await waitForHostTurns();
    expect(container.textContent).toBe("PTWO");
  });

  it("clears stale nested host wrappers across a re-suspension", async () => {
    let setGate: ((value: Promise<string>) => void) | null = null;
    const first = deferred<string>();

    function App({ initial }: { initial: Promise<string> }) {
      const [gate, set] = useState(initial);
      setGate = set;
      return createElement(
        Suspense,
        { fallback: createElement("i", null, "load") },
        createElement(
          "div",
          null,
          createElement(
            "section",
            null,
            createElement("p", null, "P"),
            createElement(makeSlow(gate), null),
          ),
        ),
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(createElement(App, { initial: first.promise })),
    );
    first.resolve("ONE");
    await waitForHostTurns();
    expect(container.textContent).toBe("PONE");

    const second = deferred<string>();
    flushSync(() => setGate?.(second.promise));
    const [primary, fallback] = container.childNodes as FakeElement[];
    expect(display(primary)).toBe("none");
    expect(display(fallback)).toBe("");
    expect(fallback.textContent).toBe("load");

    second.resolve("TWO");
    await waitForHostTurns();
    // The deeper <section> wrapper is also rebuilt cleanly, with no stale "ONE".
    const div = container.childNodes[0] as FakeElement;
    const section = div.childNodes[0] as FakeElement;
    expect(section.childNodes.map((child) => child.textContent)).toEqual([
      "P",
      "TWO",
    ]);
  });

  it("replaces children inside a revealed assembled primary that a moved wrapper inserted", async () => {
    const gate = deferred<string>();

    function Slow() {
      return createElement("em", null, readPromise(gate.promise));
    }

    function Wrapper({ swapped }: { swapped: boolean }) {
      return createElement(
        "section",
        null,
        swapped
          ? createElement("div", null, "new")
          : createElement("h1", null, "old"),
        createElement(Slow, null),
      );
    }

    function App({
      showBefore,
      swapped,
    }: {
      showBefore: boolean;
      swapped: boolean;
    }) {
      return createElement(
        Suspense,
        { fallback: createElement("i", null, "load") },
        showBefore ? createElement("span", null, "S") : null,
        createElement(Wrapper, { key: "w", swapped }),
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    // The mount suspends below the <section>: the section assembles inside a
    // render that never commits and survives only as the captured primary.
    flushSync(() =>
      root.render(createElement(App, { showBefore: false, swapped: false })),
    );
    expect(container.textContent).toBe("load");

    // While still suspended, a sibling appears before the wrapper, so the
    // reveal commit re-places the reused wrapper component and inserts the
    // never-committed section through the wrapper's subtree insertion.
    flushSync(() =>
      root.render(createElement(App, { showBefore: true, swapped: false })),
    );
    expect(container.textContent).toBe("load");

    gate.resolve("done");
    await waitForHostTurns();
    expect(container.textContent).toBe("Solddone");

    // Replacing the section's children must run as a regular update: if the
    // revealed section still claims it never committed, the next render
    // re-assembles its live instance in place and the commit crashes removing
    // the already-detached previous children.
    flushSync(() =>
      root.render(createElement(App, { showBefore: true, swapped: true })),
    );
    expect(container.textContent).toBe("Snewdone");
  });

  it("does not commit the failed primary shape while re-suspended", async () => {
    let setGate: ((value: Promise<string>) => void) | null = null;
    let setShowExtra: ((value: boolean) => void) | null = null;
    const first = deferred<string>();

    function Slow({ gate }: { gate: Promise<string> }) {
      return readPromise(gate);
    }

    function App({ initial }: { initial: Promise<string> }) {
      const [gate, setGateState] = useState(initial);
      const [showExtra, setShowExtraState] = useState(false);
      setGate = setGateState;
      setShowExtra = setShowExtraState;
      return createElement(
        Suspense,
        { fallback: createElement("i", null, "load") },
        createElement(
          "div",
          null,
          createElement("p", null, "A"),
          showExtra ? createElement("p", null, "X") : null,
          createElement(Slow, { gate }),
          createElement("p", null, "B"),
        ),
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(createElement(App, { initial: first.promise })),
    );
    first.resolve("ONE");
    await waitForHostTurns();
    expect(container.textContent).toBe("AONEB");

    const second = deferred<string>();
    flushSync(() => {
      setShowExtra?.(true);
      setGate?.(second.promise);
    });

    const [primary, fallback] = container.childNodes as FakeElement[];
    expect(display(primary)).toBe("none");
    expect(primary.textContent).toBe("AB");
    expect(fallback.textContent).toBe("load");

    second.resolve("TWO");
    await waitForHostTurns();
    expect(container.textContent).toBe("AXTWOB");
  });

  it("preserves sibling component state across a re-suspension", async () => {
    let setGate: ((value: Promise<string>) => void) | null = null;
    let increment: (() => void) | null = null;
    const first = deferred<string>();

    function Counter() {
      const [count, setCount] = useState(0);
      increment = () => setCount((value) => value + 1);
      return createElement("p", null, count);
    }

    function App({ initial }: { initial: Promise<string> }) {
      const [gate, set] = useState(initial);
      setGate = set;
      return createElement(
        Suspense,
        { fallback: createElement("i", null, "load") },
        createElement(
          "div",
          null,
          createElement(Counter, null),
          createElement(makeSlow(gate), null),
        ),
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(createElement(App, { initial: first.promise })),
    );
    first.resolve("ONE");
    await waitForHostTurns();
    expect(container.textContent).toBe("0ONE");

    // Bump the sibling's state while content is revealed.
    flushSync(() => increment?.());
    expect(container.textContent).toBe("1ONE");

    // Re-suspend and reveal: the suspending child rebuilds, but the sibling
    // Counter keeps its committed state (its fiber is reused, not rebuilt).
    const second = deferred<string>();
    flushSync(() => setGate?.(second.promise));
    const [primary, fallback] = container.childNodes as FakeElement[];
    expect(display(primary)).toBe("none");
    expect(display(fallback)).toBe("");
    expect(fallback.textContent).toBe("load");

    second.resolve("TWO");
    await waitForHostTurns();
    expect(container.textContent).toBe("1TWO");
  });

  it("re-runs effects when preserved primary content reveals after re-suspension", async () => {
    let setGate: ((value: Promise<string>) => void) | null = null;
    const calls: string[] = [];
    const first = deferred<string>();

    function Slow({ gate }: { gate: Promise<string> }) {
      return readPromise(gate);
    }

    function StableEffect() {
      useReactive((signal) => {
        calls.push("run");
        signal.addEventListener("abort", () => calls.push("abort"), {
          once: true,
        });
      }, []);
      return createElement("p", null, "P");
    }

    function App({ initial }: { initial: Promise<string> }) {
      const [gate, set] = useState(initial);
      setGate = set;
      return createElement(
        Suspense,
        { fallback: createElement("i", null, "load") },
        createElement(
          "div",
          null,
          createElement(StableEffect, null),
          createElement(Slow, { gate }),
        ),
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    root.render(createElement(App, { initial: first.promise }));
    first.resolve("ONE");
    await waitForHostTurns();
    expect(container.textContent).toBe("PONE");
    expect(calls).toEqual(["run", "abort", "run"]);

    const second = deferred<string>();
    flushSync(() => setGate?.(second.promise));
    await waitForHostTurns();
    const [primary, fallback] = container.childNodes as FakeElement[];
    expect(display(primary)).toBe("none");
    expect(display(fallback)).toBe("");
    expect(fallback.textContent).toBe("load");
    expect(calls).toEqual(["run", "abort", "run", "abort"]);

    second.resolve("TWO");
    await waitForHostTurns();
    expect(container.textContent).toBe("PTWO");
    expect(calls).toEqual(["run", "abort", "run", "abort", "run"]);
  });

  it("reattaches binds and events when preserved primary content reveals after re-suspension", async () => {
    let setGate: ((value: Promise<string>) => void) | null = null;
    const signals: AbortSignal[] = [];
    let clicks = 0;
    const first = deferred<string>();

    function Slow({ gate }: { gate: Promise<string> }) {
      return readPromise(gate);
    }

    function App({ initial }: { initial: Promise<string> }) {
      const [gate, set] = useState(initial);
      setGate = set;
      return createElement(
        Suspense,
        { fallback: createElement("i", null, "load") },
        createElement(
          "button",
          {
            bind: (_node: Element, signal: AbortSignal) => {
              signals.push(signal);
            },
            events: [on("click", () => clicks++)],
          },
          "P",
          createElement(Slow, { gate }),
        ),
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    root.render(createElement(App, { initial: first.promise }));
    first.resolve("ONE");
    await waitForHostTurns();
    const button = container.childNodes[0] as FakeElement;
    expect(container.textContent).toBe("PONE");
    expect(signals).toHaveLength(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);

    button.dispatch("click");
    expect(clicks).toBe(1);

    const second = deferred<string>();
    flushSync(() => setGate?.(second.promise));
    expect(container.textContent).toBe("load");
    expect(signals[1]?.aborted).toBe(true);

    second.resolve("TWO");
    await waitForHostTurns();
    expect(container.textContent).toBe("PTWO");
    expect(signals).toHaveLength(3);
    expect(signals[2]?.aborted).toBe(false);

    button.dispatch("click");
    expect(clicks).toBe(2);
  });

  it("applies an update dispatched into the hidden re-suspended primary on reveal", async () => {
    let counterSet: ((value: number) => void) | null = null;
    let setGate: ((value: Promise<string>) => void) | null = null;
    const first = deferred<string>();

    function Counter() {
      const [count, set] = useState(0);
      counterSet = set;
      return createElement("span", null, `c${count}`);
    }
    function Slow({ gate }: { gate: Promise<string> }) {
      return readPromise(gate);
    }
    function App({ initial }: { initial: Promise<string> }) {
      const [gate, set] = useState(initial);
      setGate = set;
      return createElement(
        Suspense,
        { fallback: createElement("i", null, "load") },
        createElement(
          "div",
          null,
          createElement(Counter, null),
          createElement(Slow, { gate }),
        ),
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(createElement(App, { initial: first.promise })),
    );
    first.resolve("A");
    await waitForHostTurns();
    expect(container.textContent).toBe("c0A");

    // Re-suspend: the committed primary is kept hidden, fallback shows.
    const second = deferred<string>();
    flushSync(() => setGate?.(second.promise));
    const [primary, fallback] = container.childNodes as FakeElement[];
    expect(display(primary)).toBe("none");
    expect(fallback.textContent).toBe("load");

    // Dispatch a state update to a component INSIDE the hidden primary. This
    // must NOT hang the scheduler (the update is downgraded to the offscreen
    // lane; it cannot make progress until the boundary reveals).
    flushSync(() => counterSet?.(5));
    await waitForHostTurns();
    // Still suspended — fallback stays IN THE DOM (a speculative reveal must
    // not commit its abandoned fallback deletion), primary stays hidden.
    expect(fallback.parentNode).toBe(container);
    expect(container.childNodes).toEqual([primary, fallback]);
    expect(fallback.textContent).toBe("load");
    expect(display(primary)).toBe("none");

    // Reveal: the parked update is applied to the now-visible primary.
    second.resolve("B");
    await waitForHostTurns();
    expect(container.textContent).toBe("c5B");
  });

  it("does not replay outside updates after a Suspense re-suspension", async () => {
    let increment: (() => void) | null = null;
    let rerenderRoot: (() => void) | null = null;
    let setGate: ((value: Promise<string>) => void) | null = null;
    const first = deferred<string>();

    function Counter({ label }: { label: string }) {
      const [count, setCount] = useState(0);
      increment = () => setCount((value) => value + 1);
      return createElement("span", null, `${label}:${count}`);
    }

    function Slow({ gate }: { gate: Promise<string> }) {
      return readPromise(gate);
    }

    function App({
      initial,
      label,
    }: {
      initial: Promise<string>;
      label: string;
    }) {
      const [gate, setGateState] = useState(initial);
      setGate = setGateState;
      return createElement(
        "main",
        null,
        createElement(Counter, { label }),
        createElement(
          Suspense,
          { fallback: createElement("i", null, "load") },
          createElement(Slow, { gate }),
        ),
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    rerenderRoot = () =>
      root.render(createElement(App, { initial: first.promise, label: "B" }));

    flushSync(() =>
      root.render(createElement(App, { initial: first.promise, label: "A" })),
    );
    first.resolve("ONE");
    await waitForHostTurns();
    expect(container.textContent).toBe("A:0ONE");

    const second = deferred<string>();
    flushSync(() => {
      increment?.();
      setGate?.(second.promise);
    });
    expect(container.textContent).toBe("A:1load");

    second.resolve("TWO");
    await waitForHostTurns();
    expect(container.textContent).toBe("A:1TWO");

    flushSync(() => rerenderRoot?.());
    expect(container.textContent).toBe("B:1TWO");
  });

  it("reveals the new state when re-suspension is driven from inside the boundary", async () => {
    let setInner:
      | ((value: { promise: Promise<string>; label: string }) => void)
      | null = null;
    const first = deferred<string>();

    function Slow({ gate }: { gate: Promise<string> }) {
      return readPromise(gate);
    }
    function Inner({ initial }: { initial: Promise<string> }) {
      const [state, set] = useState({ promise: initial, label: "ONE" });
      setInner = set;
      return createElement(
        "div",
        null,
        createElement("span", null, state.label),
        createElement(Slow, { gate: state.promise }),
      );
    }
    function App({ initial }: { initial: Promise<string> }) {
      return createElement(
        Suspense,
        { fallback: createElement("i", null, "load") },
        createElement(Inner, { initial }),
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    flushSync(() =>
      root.render(createElement(App, { initial: first.promise })),
    );
    first.resolve("X");
    await waitForHostTurns();
    expect(container.textContent).toBe("ONEX");

    // setState INSIDE the boundary changes BOTH the suspending promise and the
    // rendered label, with no parent re-render (the Suspense children element is
    // unchanged). The committed primary is kept hidden; the update is parked.
    const second = deferred<string>();
    flushSync(() => setInner?.({ promise: second.promise, label: "TWO" }));
    const [primary, fallback] = container.childNodes as FakeElement[];
    expect(display(primary)).toBe("none");
    expect(fallback.textContent).toBe("load");

    // On reveal the kept-hidden primary must re-render and apply the parked
    // update — not adopt the stale committed content (regression: was "ONEX").
    second.resolve("Y");
    await waitForHostTurns();
    expect(container.textContent).toBe("TWOY");
  });
});
