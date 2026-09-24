import {
  Activity,
  createElement,
  readDataStore,
  readPromise,
  Suspense,
  transition,
  useState,
  useTransition,
  type StartTransition,
  type TransitionUpdate,
} from "@bgub/fig";
import { expect, it } from "vitest";
import { createRoot, flushSync } from "./index.ts";
import {
  deferred,
  FakeElement,
  installFakeDocument,
  waitForHostTurns,
} from "./test-utils.ts";

installFakeDocument();

it("lets an explicit async sibling update finish while another scope and render remain pending", async () => {
  const content = deferred<string>();
  const slowGate = deferred<void>();
  const fastGate = deferred<void>();
  let slow!: () => void;
  let fast!: () => void;
  function Slow() {
    const [value, set] = useState<Promise<string> | null>(null);
    const [pending, start] = useTransition();
    slow = () =>
      start(async () => {
        set(content.promise);
        await slowGate.promise;
      });
    return createElement(
      "section",
      null,
      `${pending}:`,
      createElement(
        Suspense,
        { fallback: "loading" },
        createElement(Message, { value }),
      ),
    );
  }
  function Message({ value }: { value: Promise<string> | null }) {
    return value === null ? "old" : readPromise(value);
  }
  function Fast() {
    const [value, set] = useState("old");
    const [pending, start] = useTransition();
    fast = () =>
      start(async (_signal, update) => {
        await fastGate.promise;
        update(() => set("new"));
      });
    return createElement("aside", null, `${pending}:${value}`);
  }
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element);
  flushSync(() =>
    root.render(
      createElement(
        "main",
        null,
        createElement(Slow, null),
        createElement(Fast, null),
      ),
    ),
  );
  slow();
  await waitForHostTurns();
  fast();
  fastGate.resolve(undefined);
  await waitForHostTurns();
  expect(container.textContent).toBe("true:oldfalse:new");
  content.resolve("loaded");
  await waitForHostTurns();
  expect(container.textContent).toBe("true:loadedfalse:new");
  slowGate.resolve(undefined);
  await waitForHostTurns();
  expect(container.textContent).toBe("false:loadedfalse:new");
  root.unmount();
});

it("does not capture ordinary updates while an async transition is pending", async () => {
  const scope = deferred<void>();
  const content = deferred<string>();
  let set!: (value: Promise<string>) => void;
  function App() {
    const [value, update] = useState<Promise<string> | null>(null);
    set = update;
    return createElement(
      Suspense,
      { fallback: "loading" },
      createElement(Message, { value }),
    );
  }
  function Message({ value }: { value: Promise<string> | null }) {
    return value === null ? "old" : readPromise(value);
  }
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element);
  flushSync(() => root.render(createElement(App, null)));
  const pending = transition(() => scope.promise);
  await Promise.resolve();
  set(content.promise);
  await waitForHostTurns();
  expect(container.textContent).toContain("loading");
  content.resolve("new");
  scope.resolve(undefined);
  await pending;
  await waitForHostTurns();
  expect(container.textContent).toBe("new");
  root.unmount();
});

for (const retirement of ["supersede", "unmount", "hide"] as const) {
  it(`makes the entire update callback inert after ${retirement}`, async () => {
    const gate = deferred<void>();
    let start!: StartTransition;
    let scopedUpdate!: TransitionUpdate;
    let capturedSignal!: AbortSignal;
    const calls: string[] = [];
    function App() {
      [, start] = useTransition();
      return "mounted";
    }
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    const tree = (mode: "visible" | "hidden") =>
      createElement(Activity, { mode }, createElement(App, null));
    flushSync(() => root.render(tree("visible")));
    start(async (signal, update) => {
      scopedUpdate = update;
      capturedSignal = signal;
      await gate.promise;
      update(() => {
        calls.push("after await");
      });
    });
    await waitForHostTurns();
    if (retirement === "supersede") start(() => undefined);
    else if (retirement === "unmount") root.unmount();
    else flushSync(() => root.render(tree("hidden")));
    expect(capturedSignal.aborted).toBe(true);
    scopedUpdate(() => {
      calls.push("external");
    });
    gate.resolve(undefined);
    await waitForHostTurns();
    expect(calls).toEqual([]);
    root.unmount();
  });
}

it("re-enters the owning root's data store after await", async () => {
  let start!: StartTransition;
  let completed!: Promise<void>;
  const stores: unknown[] = [];
  function App() {
    [, start] = useTransition();
    return "mounted";
  }
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element);
  flushSync(() => root.render(createElement(App, null)));
  start((_signal, update) => {
    stores.push(readDataStore());
    completed = (async () => {
      await Promise.resolve();
      expect(() => readDataStore()).toThrow();
      update(() => {
        stores.push(readDataStore());
      });
    })();
    return completed;
  });
  await completed;
  expect(stores[1]).toBe(stores[0]);
  root.unmount();
});

it("keeps a stale starter's explicit updates inert after unmount", () => {
  let start!: StartTransition;
  let called = false;
  function App() {
    [, start] = useTransition();
    return "mounted";
  }
  const root = createRoot(new FakeElement("root") as unknown as Element);
  flushSync(() => root.render(createElement(App, null)));
  root.unmount();
  start((signal, update) => {
    expect(signal.aborted).toBe(true);
    update(() => {
      called = true;
    });
  });
  expect(called).toBe(false);
});

it("captures the current data store for a standalone async transition", async () => {
  let start!: StartTransition;
  let completed!: Promise<void>;
  const stores: unknown[] = [];
  function App() {
    [, start] = useTransition();
    return "mounted";
  }
  const root = createRoot(new FakeElement("root") as unknown as Element);
  flushSync(() => root.render(createElement(App, null)));
  start(() => {
    completed = transition(async (_signal, update) => {
      stores.push(readDataStore());
      await Promise.resolve();
      expect(() => readDataStore()).toThrow();
      update(() => {
        stores.push(readDataStore());
      });
    });
    return completed;
  });
  await completed;
  expect(stores).toHaveLength(2);
  expect(stores[1]).toBe(stores[0]);
  root.unmount();
});

it("does not borrow another caller's data store for a scope that began without one", async () => {
  const gate = deferred<void>();
  let scopedUpdate!: TransitionUpdate;
  const pending = transition((_signal, update) => {
    scopedUpdate = update;
    return gate.promise;
  });
  let start!: StartTransition;
  function App() {
    [, start] = useTransition();
    return "mounted";
  }
  const root = createRoot(new FakeElement("root") as unknown as Element);
  flushSync(() => root.render(createElement(App, null)));
  start(() => {
    const store = readDataStore();
    scopedUpdate(() => {
      expect(() => readDataStore()).toThrow();
    });
    expect(readDataStore()).toBe(store);
  });
  gate.resolve(undefined);
  await pending;
  root.unmount();
});
