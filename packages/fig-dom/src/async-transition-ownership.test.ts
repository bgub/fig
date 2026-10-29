import {
  Activity,
  createElement,
  readDataStore,
  readPromise,
  Suspense,
  transition,
  useActionState,
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

for (const asynchronous of [false, true]) {
  it(`retires a successfully settled ${asynchronous ? "async" : "sync"} action signal exactly once`, async () => {
    const gate = deferred<string>();
    let run!: () => void;
    let capturedSignal!: AbortSignal;
    let retirements = 0;
    function App() {
      const [value, dispatch, pending] = useActionState(
        (_previous: string, signal: AbortSignal) => {
          capturedSignal = signal;
          expect(signal.aborted).toBe(false);
          signal.addEventListener("abort", () => retirements++);
          return asynchronous ? gate.promise : "saved";
        },
        "initial",
      );
      run = dispatch;
      return `${pending}:${value}`;
    }
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    try {
      flushSync(() => root.render(createElement(App, null)));
      run();
      expect(capturedSignal.aborted).toBe(!asynchronous);
      if (asynchronous) {
        await waitForHostTurns();
        expect(container.textContent).toBe("true:initial");
        gate.resolve("saved");
      }
      await waitForHostTurns();
      expect(capturedSignal.aborted).toBe(true);
      expect(retirements).toBe(1);
      expect(container.textContent).toBe("false:saved");
    } finally {
      root.unmount();
    }
    expect(retirements).toBe(1);
  });
}

it("keeps an async action result in its own lane and retires its signal before a suspended commit", async () => {
  const slowContent = deferred<string>();
  const slowGate = deferred<void>();
  const actionGate = deferred<void>();
  const actionContent = deferred<string>();
  let slow!: () => void;
  let run!: () => void;
  let actionSignal!: AbortSignal;
  function Message({ value }: { value: Promise<string> | null }) {
    return value === null ? "old" : readPromise(value);
  }
  function Slow() {
    const [value, set] = useState<Promise<string> | null>(null);
    const [pending, start] = useTransition();
    slow = () =>
      start(async () => {
        set(slowContent.promise);
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
  function Action() {
    const [value, dispatch, pending] = useActionState(
      async (
        _previous: { promise: Promise<string> } | null,
        signal: AbortSignal,
      ) => {
        actionSignal = signal;
        await actionGate.promise;
        expect(signal.aborted).toBe(false);
        return { promise: actionContent.promise };
      },
      null,
    );
    run = dispatch;
    return createElement(
      "aside",
      null,
      `${pending}:`,
      createElement(
        Suspense,
        { fallback: "loading" },
        createElement(Message, { value: value?.promise ?? null }),
      ),
    );
  }
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element);
  try {
    flushSync(() =>
      root.render(
        createElement(
          "main",
          null,
          createElement(Slow, null),
          createElement(Action, null),
        ),
      ),
    );
    slow();
    await waitForHostTurns();
    run();
    await waitForHostTurns();
    expect(container.textContent).toBe("true:oldtrue:old");
    expect(actionSignal.aborted).toBe(false);
    actionGate.resolve(undefined);
    await waitForHostTurns();
    // Settlement closes the scope even though its result still suspends.
    expect(actionSignal.aborted).toBe(true);
    expect(container.textContent).toBe("true:oldtrue:old");
    actionContent.resolve("saved");
    await waitForHostTurns();
    expect(container.textContent).toBe("true:oldfalse:saved");
    slowContent.resolve("loaded");
    slowGate.resolve(undefined);
    await waitForHostTurns();
    expect(container.textContent).toBe("false:loadedfalse:saved");
  } finally {
    root.unmount();
  }
});

it("leaves post-await action setters at ordinary priority while another transition is pending", async () => {
  const scopeGate = deferred<void>();
  const actionGate = deferred<void>();
  const finishGate = deferred<void>();
  const content = deferred<string>();
  let run!: () => void;
  function Message({ value }: { value: Promise<string> | null }) {
    return value === null ? "old" : readPromise(value);
  }
  function App() {
    const [sideValue, setSideValue] = useState<Promise<string> | null>(null);
    const [value, dispatch, pending] = useActionState(
      async (_previous: string, _signal: AbortSignal) => {
        await actionGate.promise;
        setSideValue(content.promise);
        await finishGate.promise;
        return "saved";
      },
      "initial",
    );
    run = dispatch;
    return createElement(
      "main",
      null,
      `${pending}:${value}:`,
      createElement(
        Suspense,
        { fallback: "loading" },
        createElement(Message, { value: sideValue }),
      ),
    );
  }
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element);
  let scope: Promise<void> | undefined;
  try {
    flushSync(() => root.render(createElement(App, null)));
    scope = transition(() => scopeGate.promise);
    run();
    await waitForHostTurns();
    expect(container.textContent).toBe("true:initial:old");
    actionGate.resolve(undefined);
    await waitForHostTurns();
    // An ordinary update reveals the fallback instead of retaining old content.
    expect(container.textContent).toBe("true:initial:loading");
    content.resolve("loaded");
    finishGate.resolve(undefined);
    await waitForHostTurns();
    expect(container.textContent).toBe("false:saved:loaded");
  } finally {
    scopeGate.resolve(undefined);
    await scope;
    root.unmount();
  }
});

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
