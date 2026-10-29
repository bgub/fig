import {
  createElement,
  readPromise,
  Suspense,
  transition,
  type StateSetter,
  useState,
  useBeforePaint,
  useDeferredValue,
} from "@bgub/fig";
import { renderToHtml } from "@bgub/fig-server";
import { afterEach, expect, it, vi } from "vitest";
import * as scheduler from "../../fig-reconciler/src/scheduler.ts";
import { createRoot, type FigRoot, flushSync, hydrateRoot } from "./index.ts";
import {
  deferred,
  FakeElement,
  FakeText,
  installFakeDocument,
  waitForHostTurns,
} from "./test-utils.ts";

installFakeDocument();
const roots: FigRoot[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) flushSync(() => root.unmount());
});

it.each([
  { mounted: false, unitsBeforeYield: 0 },
  { mounted: true, unitsBeforeYield: 0 },
  { mounted: true, unitsBeforeYield: 1 },
])(
  "keeps a root render queued during a yield (mounted: $mounted, completed units: $unitsBeforeYield)",
  async ({ mounted, unitsBeforeYield }) => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    roots.push(root);
    if (mounted)
      flushSync(() => root.render(createElement("span", null, "initial")));

    let checks = 0;
    let queuedDuringYield = false;
    const shouldYield = scheduler.shouldYieldToHost;
    vi.spyOn(scheduler, "shouldYieldToHost").mockImplementation(() => {
      if (checks++ !== unitsBeforeYield) return shouldYield();
      scheduler.requestPaint();
      queueMicrotask(() => {
        queuedDuringYield = true;
        root.render(createElement("span", null, "latest"));
      });
      return true;
    });

    root.render(createElement("span", null, "intermediate"));
    await waitForHostTurns(15);
    expect(queuedDuringYield).toBe(true);
    // No subsequent update or flushSync should be needed to rescue this work.
    expect(container.textContent).toBe("latest");
  },
);

it("rebases alternating urgent and deferred functional updates in dispatch order", async () => {
  let set: StateSetter<number> = () => {};
  function Counter() {
    const [count, setter] = useState(1);
    set = setter;
    return createElement("span", null, count);
  }
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element);
  roots.push(root);
  flushSync(() => root.render(createElement(Counter, null)));
  set((value) => value * 10);
  flushSync(() => set((value) => value + 1));
  expect(container.textContent).toBe("2");
  set((value) => value * 3);
  flushSync(() => set((value) => value + 100));
  expect(container.textContent).toBe("102");
  await waitForHostTurns();
  expect(container.textContent).toBe("133");
});

it("preserves functional updates made while suspended primary content is hidden", async () => {
  const gate = deferred<string>();
  let set: StateSetter<number> = () => {};
  function Counter() {
    const [count, setter] = useState(1);
    set = setter;
    if (count > 1) readPromise(gate.promise);
    return createElement("span", null, count);
  }
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element);
  roots.push(root);
  flushSync(() =>
    root.render(
      createElement(
        Suspense,
        { fallback: createElement("i", null, "loading") },
        createElement(Counter, null),
      ),
    ),
  );
  flushSync(() => set((value) => value + 1));
  flushSync(() => set((value) => value * 10));
  gate.resolve("ready");
  await waitForHostTurns();
  expect(container.textContent).toBe("20");
});

it.each(["promise", "urgent reveal"] as const)(
  "reveals attempted rebase history without committing stale state on %s",
  async (resume) => {
    const gate = deferred<void>();
    let setCount!: StateSetter<number>;
    let setBlocked!: StateSetter<boolean>;
    const commits: number[] = [];
    function Counter({ blocked }: { blocked: boolean }) {
      const [count, set] = useState(0);
      setCount = set;
      if (count === 11 && blocked) readPromise(gate.promise);
      useBeforePaint(() => {
        commits.push(count);
      });
      return createElement("span", null, count);
    }
    function App() {
      const [blocked, set] = useState(true);
      setBlocked = set;
      return createElement(
        Suspense,
        { fallback: createElement("i", null, "loading") },
        createElement(Counter, { blocked }),
      );
    }
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    roots.push(root);
    flushSync(() => root.render(createElement(App)));
    setCount((value) => value + 1);
    flushSync(() => setCount((value) => value + 10));
    expect(container.textContent).toBe("10");
    await waitForHostTurns();
    expect(container.textContent).toBe("10loading");
    commits.length = 0;
    if (resume === "promise") gate.resolve(undefined);
    else flushSync(() => setBlocked(false));
    await waitForHostTurns();
    expect(container.textContent).toBe("11");
    expect(commits).toEqual([11]);
    gate.resolve(undefined);
    await waitForHostTurns();
  },
);

it("keeps rebase priorities when a rendered fallback is abandoned", async () => {
  const gate = deferred<void>();
  let setCount!: StateSetter<number>;
  let renderedFallback = false;
  let interrupted = false;
  let committedFallback = false;
  let urgentText = "";
  function Counter({ blocked }: { blocked: boolean }) {
    const [count, set] = useState(0);
    setCount = set;
    if (count === 11 && blocked) readPromise(gate.promise);
    return createElement("span", null, count);
  }
  function Fallback() {
    renderedFallback = true;
    useBeforePaint(() => {
      committedFallback = true;
    });
    return createElement("i", null, "loading");
  }
  const tree = (blocked: boolean) =>
    createElement(
      Suspense,
      { fallback: createElement(Fallback) },
      createElement(Counter, { blocked }),
    );
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element);
  roots.push(root);
  flushSync(() => root.render(tree(true)));
  const shouldYield = scheduler.shouldYieldToHost;
  vi.spyOn(scheduler, "shouldYieldToHost").mockImplementation(() => {
    if (renderedFallback && !interrupted) {
      interrupted = true;
      scheduler.requestPaint();
      queueMicrotask(() => {
        flushSync(() => root.render(tree(false)));
        urgentText = container.textContent;
      });
      return true;
    }
    return shouldYield();
  });
  setCount((value) => value + 1);
  flushSync(() => setCount((value) => value + 10));
  await waitForHostTurns(15);
  expect(interrupted).toBe(true);
  expect(committedFallback).toBe(false);
  expect(urgentText).toBe("10");
  expect(container.textContent).toBe("11");
  gate.resolve(undefined);
  await waitForHostTurns();
});

it("retains a suspended transition update when urgent work commits on the same queue", async () => {
  const gate = deferred<string>();
  let set: StateSetter<number> = () => {};
  function Counter() {
    const [count, setter] = useState(0);
    set = setter;
    if (count === 1) readPromise(gate.promise);
    return createElement("span", null, count);
  }
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element);
  roots.push(root);
  flushSync(() =>
    root.render(
      createElement(
        Suspense,
        { fallback: createElement("i", null, "loading") },
        createElement(Counter, null),
      ),
    ),
  );
  transition(() => set((value) => value + 1));
  await waitForHostTurns();
  expect(container.textContent).toBe("0");
  flushSync(() => set((value) => value + 10));
  expect(container.textContent).toBe("10");
  gate.resolve("ready");
  await waitForHostTurns();
  expect(container.textContent).toBe("11");
});

it.each([false, true])(
  "does not promote skipped transition state when a sync suspension reveals before the transition (rebased: %s)",
  async (rebased) => {
    const gate = deferred<string>();
    let setCount: StateSetter<number> = () => {};
    let setSibling: StateSetter<number> = () => {};
    let setBlocked: StateSetter<boolean> = () => {};
    function Counter({ blocked }: { blocked: boolean }) {
      const [count, set] = useState(0);
      setCount = set;
      if (count >= 10 && blocked) readPromise(gate.promise);
      return createElement("span", null, count);
    }
    function Sibling() {
      const [count, set] = useState(0);
      setSibling = set;
      return createElement("b", null, "|", count);
    }
    function App() {
      const [blocked, set] = useState(true);
      setBlocked = set;
      return createElement(
        "main",
        null,
        createElement(
          Suspense,
          { fallback: createElement("i", null, "loading") },
          createElement(Counter, { blocked }),
        ),
        createElement(Sibling, null),
      );
    }
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    roots.push(root);
    flushSync(() => root.render(createElement(App, null)));
    transition(() => {
      setCount((value) => value + 1);
      setSibling((value) => value + 1);
    });
    if (rebased) flushSync(() => setCount((value) => value));
    flushSync(() => setCount((value) => value + 10));
    flushSync(() => setBlocked(false));
    expect(container.textContent).toBe("10|0");
    gate.resolve("ready");
    await waitForHostTurns();
    expect(container.textContent).toBe("11|1");
  },
);

it("retires committed root-transition dependencies before the lane pool wraps", async () => {
  const gate = deferred<string>();
  let suspend: StateSetter<boolean> = () => {};
  function Content() {
    const [pending, set] = useState(false);
    suspend = set;
    if (pending) readPromise(gate.promise);
    return createElement("b", null, "ready");
  }
  const content = createElement(
    Suspense,
    { fallback: createElement("i", null, "loading") },
    createElement(Content, null),
  );
  function App({ label }: { label: string }) {
    return createElement("main", null, label, content);
  }
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element);
  roots.push(root);
  flushSync(() => root.render(createElement(App, { label: "initial:" })));
  transition(() => root.render(createElement(App, { label: "committed:" })));
  await waitForHostTurns();
  expect(container.textContent).toBe("committed:ready");
  // The transition pool has ten lanes. Reuse the root's now-completed lane
  // for independent suspended component state, then update the root again.
  for (let index = 0; index < 9; index += 1) transition(() => {});
  transition(() => suspend(true));
  await waitForHostTurns();
  expect(container.textContent).toBe("committed:ready");
  transition(() => root.render(createElement(App, { label: "independent:" })));
  await waitForHostTurns();
  expect(container.textContent).toBe("independent:ready");
  gate.resolve("ready");
  await waitForHostTurns();
  expect(container.textContent).toBe("independent:ready");
});

it("hydrates deferred values using the server value rather than a client mount placeholder", async () => {
  function App() {
    const value = useDeferredValue("ready", "loading");
    return createElement("span", null, value);
  }
  expect(await renderToHtml(createElement(App))).toBe("<span>ready</span>");
  const container = new FakeElement("root");
  const span = new FakeElement("span");
  span.appendChild(new FakeText("ready"));
  container.appendChild(span);
  const errors: unknown[] = [];
  flushSync(() => {
    roots.push(
      hydrateRoot(container as unknown as Element, createElement(App), {
        onRecoverableError(error) {
          errors.push(error);
        },
      }),
    );
  });
  expect(errors).toEqual([]);
  expect(container.childNodes).toEqual([span]);
  expect(container.textContent).toBe("ready");
  await waitForHostTurns();
  expect(container.textContent).toBe("ready");
});

it("still renders the initial deferred placeholder on a client-only mount", async () => {
  function App() {
    return createElement("span", null, useDeferredValue("ready", "loading"));
  }
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element);
  roots.push(root);
  flushSync(() => root.render(createElement(App)));
  expect(container.textContent).toBe("loading");
  await waitForHostTurns();
  expect(container.textContent).toBe("ready");
});

it("retains attempted updates when an outer fallback discards an inner fallback", async () => {
  const innerGate = deferred<string>();
  const outerGate = deferred<string>();
  let setCount: StateSetter<number> = () => {};
  let setBlocked: StateSetter<boolean> = () => {};
  function Counter() {
    const [count, set] = useState(1);
    setCount = set;
    if (count > 1) readPromise(innerGate.promise);
    return createElement("span", null, count);
  }
  function OuterBlocker() {
    const [blocked, set] = useState(false);
    setBlocked = set;
    if (blocked) readPromise(outerGate.promise);
    return null;
  }
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element);
  roots.push(root);
  flushSync(() =>
    root.render(
      createElement(
        Suspense,
        { fallback: createElement("i", null, "outer") },
        createElement(
          Suspense,
          { fallback: createElement("i", null, "inner") },
          createElement(Counter),
        ),
        createElement(OuterBlocker),
      ),
    ),
  );
  flushSync(() => {
    setCount((value) => value + 1);
    setBlocked(true);
  });
  expect(container.textContent).toBe("1outer");
  expect((container.childNodes[0] as FakeElement).style.display).toBe("none");
  outerGate.resolve("ready");
  await waitForHostTurns();
  expect(container.textContent).toBe("1inner");
  expect((container.childNodes[0] as FakeElement).style.display).toBe("none");
  innerGate.resolve("ready");
  await waitForHostTurns();
  expect(container.textContent).toBe("2");
});
