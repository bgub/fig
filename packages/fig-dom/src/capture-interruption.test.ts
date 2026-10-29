// @vitest-environment happy-dom
import {
  createElement,
  transition,
  useBeforePaint,
  useState,
  useSyncExternalStore,
  ViewTransition,
  type StateSetter,
} from "@bgub/fig";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { serverRuntimeCodeFor } from "../../fig-server/src/protocol.ts";
import { createRoot, flushSync } from "./index.ts";
import { viewTransitionHostConfig } from "./view-transition.ts";
import { enableViewTransitions } from "./view-transitions.ts";
import { waitForHostTurns } from "./test-utils.ts";

enableViewTransitions();

const nativeStart = Object.getOwnPropertyDescriptor(
  document,
  "startViewTransition",
);
const nativeAnimate = Object.getOwnPropertyDescriptor(
  document.documentElement,
  "animate",
);
beforeEach(() => {
  Object.defineProperty(document.documentElement, "animate", {
    configurable: true,
    writable: true,
    value: () => ({ cancel() {} }),
  });
  Object.defineProperty(document, "startViewTransition", {
    configurable: true,
    writable: true,
    value: () => {},
  });
});
afterEach(() => {
  if (nativeAnimate)
    Object.defineProperty(document.documentElement, "animate", nativeAnimate);
  else Reflect.deleteProperty(document.documentElement, "animate");
  if (nativeStart)
    Object.defineProperty(document, "startViewTransition", nativeStart);
  else Reflect.deleteProperty(document, "startViewTransition");
});

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

it("cancels a synchronously rejected capture after acquiring its native handle", async () => {
  const ready = deferred();
  const finished = deferred();
  const skip = vi.fn(() => ready.reject(new Error("Transition was skipped")));
  const start = vi
    .spyOn(document, "startViewTransition")
    .mockImplementation((input) => {
      const update = typeof input === "function" ? input : input!.update!;
      void update();
      return {
        ready: ready.promise,
        finished: finished.promise,
        updateCallbackDone: Promise.resolve(),
        skipTransition: skip,
        types: new Set<string>(),
      };
    });
  const restored = vi.fn();
  const settled = vi.fn();
  try {
    const result = viewTransitionHostConfig.commit(
      document.createElement("div"),
      { interrupt: false, types: [] },
      () => {},
      () => ({
        canceledNames: [],
        cancelRootSnapshot: true,
        cancelTransition: true,
      }),
      restored,
      settled,
    );
    expect(result).toBe("committed");
    expect(skip).toHaveBeenCalledOnce();
    expect(restored).toHaveBeenCalledExactlyOnceWith(false);
    expect(settled).toHaveBeenCalledOnce();
    expect(
      viewTransitionHostConfig.suspend?.(
        document.createElement("div"),
        { interrupt: false, types: [] },
        () => {},
      ),
    ).toBe(false);
    ready.resolve();
    finished.resolve();
    await waitForHostTurns();
    expect(restored).toHaveBeenCalledOnce();
    expect(settled).toHaveBeenCalledOnce();
  } finally {
    ready.resolve();
    finished.resolve();
    start.mockRestore();
  }
});

it.each(["available", "throws", "missing"] as const)(
  "retries a stale capture without waiting for its animation (native skip: %s)",
  async (cancellation) => {
    const container = document.createElement("div");
    document.body.append(container);
    const captures: Array<{
      update: () => void;
      ready: ReturnType<typeof deferred>;
      finished: ReturnType<typeof deferred>;
      skip: ReturnType<typeof vi.fn>;
    }> = [];
    const start = vi
      .spyOn(document, "startViewTransition")
      .mockImplementation((input) => {
        const update = typeof input === "function" ? input : input!.update!;
        const ready = deferred();
        const finished = deferred();
        const skip = vi.fn(() => {
          if (cancellation === "throws") throw new Error("skip failed");
        });
        const native = {
          ready: ready.promise,
          finished: finished.promise,
          updateCallbackDone: Promise.resolve(),
          skipTransition: skip,
          types: new Set<string>(),
        };
        if (cancellation === "missing")
          Reflect.deleteProperty(native, "skipTransition");
        captures.push({
          update: () => {
            void update();
          },
          ready,
          finished,
          skip,
        });
        return native;
      });
    let snapshot = "old";
    const listeners = new Set<() => void>();
    const subscribe = (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    };
    const onTransition = vi.fn();
    function App({ label }: { label: string }) {
      const value = useSyncExternalStore(subscribe, () => snapshot);
      return createElement(
        ViewTransition,
        { name: "card", onTransition },
        createElement(
          "section",
          { style: { viewTransitionName: `author-${label}` } },
          `${label}:${value}`,
        ),
      );
    }
    const root = createRoot(container);
    const originalRootName = document.documentElement.style.viewTransitionName;
    try {
      flushSync(() => root.render(createElement(App, { label: "initial" })));
      transition(() => root.render(createElement(App, { label: "next" })));
      await waitForHostTurns(10);
      expect(captures).toHaveLength(1);
      // Keep the update non-urgent: automatic rejection must cancel capture
      // without help from flushSync or the synchronous interruption path.
      transition(() => {
        snapshot = "new";
        for (const listener of listeners) listener();
      });
      captures[0].update();
      expect(container.textContent).toBe("initial:old");
      expect(container.querySelector("section")!.style.viewTransitionName).toBe(
        "author-initial",
      );
      expect(document.documentElement.style.viewTransitionName).toBe(
        originalRootName,
      );
      expect(captures[0].skip).toHaveBeenCalledTimes(
        cancellation === "missing" ? 0 : 1,
      );
      await waitForHostTurns(10);
      // Neither ready nor finished from the abandoned animation has settled.
      expect(captures).toHaveLength(2);
      const preparedName =
        container.querySelector("section")!.style.viewTransitionName;
      captures[0].update();
      captures[0].ready.resolve();
      captures[0].finished.resolve();
      await waitForHostTurns();
      expect(container.querySelector("section")!.style.viewTransitionName).toBe(
        preparedName,
      );
      expect(onTransition).not.toHaveBeenCalled();
      captures[1].update();
      captures[1].ready.resolve();
      await waitForHostTurns();
      expect(container.textContent).toBe("next:new");
      expect(container.querySelector("section")!.style.viewTransitionName).toBe(
        "author-next",
      );
      expect(onTransition).toHaveBeenCalledOnce();
    } finally {
      root.unmount();
      for (const capture of captures) {
        capture.ready.resolve();
        capture.finished.resolve();
      }
      await waitForHostTurns();
      start.mockRestore();
      container.remove();
    }
  },
);

it.each(["before-update", "before-ready"] as const)(
  "flushes synchronous work during capture %s and ignores late browser callbacks",
  async (phase) => {
    const container = document.createElement("div");
    document.body.append(container);
    const captures: Array<{
      update: () => void;
      ready: ReturnType<typeof deferred>;
      finished: ReturnType<typeof deferred>;
      skip: ReturnType<typeof vi.fn>;
    }> = [];
    const start = vi
      .spyOn(document, "startViewTransition")
      .mockImplementation((input) => {
        const update = typeof input === "function" ? input : input!.update!;
        const ready = deferred();
        const finished = deferred();
        const skip = vi.fn();
        captures.push({
          update: () => {
            void update();
          },
          ready,
          finished,
          skip,
        });
        if (phase === "before-ready") void update();
        return {
          ready: ready.promise,
          finished: finished.promise,
          updateCallbackDone: Promise.resolve(),
          skipTransition: skip,
          types: new Set(),
        };
      });
    let set: StateSetter<string> = () => {};
    const committed: string[] = [];
    const onTransition = vi.fn();
    function App() {
      const [label, update] = useState("initial");
      set = update;
      useBeforePaint(() => {
        committed.push(label);
      }, [label]);
      return createElement(
        ViewTransition,
        { name: "card", update: "fade", onTransition },
        createElement(
          "section",
          {
            style: {
              viewTransitionName: `author-${label}`,
              viewTransitionClass: `class-${label}`,
            },
          },
          label,
        ),
      );
    }
    const root = createRoot(container);
    const originalRootName = document.documentElement.style.viewTransitionName;
    try {
      flushSync(() => root.render(createElement(App)));
      committed.length = 0;
      transition(() => set("pending"));
      await waitForHostTurns(10);
      expect(captures).toHaveLength(1);
      expect(container.textContent).toBe(
        phase === "before-update" ? "initial" : "pending",
      );
      flushSync(() => set("urgent"));
      expect(container.textContent).toBe("urgent");
      expect(committed).toEqual(["pending", "urgent"]);
      expect(captures[0].skip).toHaveBeenCalledOnce();
      expect(container.querySelector("section")!.style.viewTransitionName).toBe(
        "author-urgent",
      );
      expect(
        container.querySelector("section")!.style.viewTransitionClass,
      ).toBe("class-urgent");
      expect(document.documentElement.style.viewTransitionName).toBe(
        originalRootName,
      );
      expect(onTransition).not.toHaveBeenCalled();

      // A newer capture owns temporary names when the old browser callbacks arrive.
      transition(() => set("next"));
      await waitForHostTurns(10);
      expect(captures).toHaveLength(2);
      const name = container.querySelector("section")!.style.viewTransitionName;
      const rootName = document.documentElement.style.viewTransitionName;
      captures[0].update();
      captures[0].ready.resolve();
      captures[0].finished.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(container.querySelector("section")!.style.viewTransitionName).toBe(
        name,
      );
      expect(document.documentElement.style.viewTransitionName).toBe(rootName);
      expect(onTransition).not.toHaveBeenCalled();
      captures[1].update();
      captures[1].ready.resolve();
      await waitForHostTurns();
      expect(container.textContent).toBe("next");
      expect(container.querySelector("section")!.style.viewTransitionName).toBe(
        "author-next",
      );
      expect(onTransition).toHaveBeenCalledOnce();
    } finally {
      root.unmount();
      for (const capture of captures) {
        capture.ready.resolve();
        capture.finished.resolve();
      }
      await waitForHostTurns();
      start.mockRestore();
      container.remove();
    }
  },
);

it.each([false, true])(
  "discards stale snapshots before urgent work (skip throws: %s)",
  async (skipThrows) => {
    const container = document.createElement("div");
    document.body.append(container);
    let nativeUpdate = () => {};
    const ready = deferred();
    const finished = deferred();
    const start = vi
      .spyOn(document, "startViewTransition")
      .mockImplementation((input) => {
        const update = typeof input === "function" ? input : input!.update!;
        nativeUpdate = () => {
          void update();
        };
        return {
          ready: ready.promise,
          finished: finished.promise,
          updateCallbackDone: Promise.resolve(),
          types: new Set(),
          skipTransition() {
            if (skipThrows) throw new Error("skip failed");
          },
        };
      });
    let snapshot = "old";
    let set: StateSetter<number> = () => {};
    const committed: string[] = [];
    const onTransition = vi.fn();
    function App() {
      const [count, update] = useState(1);
      set = update;
      const value = useSyncExternalStore(
        () => () => {},
        () => snapshot,
      );
      const label = `${count}:${value}`;
      useBeforePaint(() => {
        committed.push(label);
      }, [label]);
      return createElement(
        ViewTransition,
        { name: "card", onTransition },
        createElement("span", null, label),
      );
    }
    const root = createRoot(container);
    try {
      flushSync(() => root.render(createElement(App)));
      committed.length = 0;
      transition(() => set((value) => value * 10));
      await waitForHostTurns(10);
      expect(start).toHaveBeenCalledOnce();
      snapshot = "new";
      flushSync(() => set((value) => value + 1));
      expect(container.textContent).toBe("2:new");
      expect(committed).toEqual(["2:new"]);
      await waitForHostTurns(10);
      // The deferred multiplication is replayed before the later addition.
      nativeUpdate();
      ready.resolve();
      finished.resolve();
      await waitForHostTurns(10);
      expect(container.textContent).toBe("11:new");
      expect(committed).not.toContain("10:old");
    } finally {
      root.unmount();
      ready.resolve();
      finished.resolve();
      await waitForHostTurns();
      start.mockRestore();
      container.remove();
    }
  },
);

it.each(["before-update", "before-ready"] as const)(
  "unmounts synchronously during capture %s",
  async (phase) => {
    const container = document.createElement("div");
    document.body.append(container);
    let nativeUpdate = () => {};
    const ready = deferred();
    const finished = deferred();
    const skip = vi.fn();
    const start = vi
      .spyOn(document, "startViewTransition")
      .mockImplementation((input) => {
        const update = typeof input === "function" ? input : input!.update!;
        nativeUpdate = () => {
          void update();
        };
        if (phase === "before-ready") void update();
        return {
          ready: ready.promise,
          finished: finished.promise,
          updateCallbackDone: Promise.resolve(),
          types: new Set(),
          skipTransition: skip,
        };
      });
    let set: StateSetter<string> = () => {};
    let cleanup = 0;
    function App() {
      const [label, update] = useState("old");
      set = update;
      useBeforePaint((signal) => {
        signal.addEventListener("abort", () => {
          cleanup += 1;
        });
      }, []);
      return createElement(
        ViewTransition,
        { name: "card" },
        createElement("span", null, label),
      );
    }
    const root = createRoot(container);
    try {
      flushSync(() => root.render(createElement(App)));
      cleanup = 0;
      transition(() => set("pending"));
      await waitForHostTurns(10);
      root.unmount();
      expect(container.textContent).toBe("");
      expect(cleanup).toBe(1);
      expect(skip).toHaveBeenCalledOnce();
      const replacement = createRoot(container);
      flushSync(() =>
        replacement.render(createElement("span", null, "replacement")),
      );
      nativeUpdate();
      ready.resolve();
      finished.resolve();
      await waitForHostTurns();
      expect(container.textContent).toBe("replacement");
      replacement.unmount();
    } finally {
      root.unmount();
      ready.resolve();
      finished.resolve();
      await waitForHostTurns();
      start.mockRestore();
      container.remove();
    }
  },
);

it("cancels a chained capture before its native transition starts", async () => {
  const container = document.createElement("div");
  const previous = deferred();
  const owner = document as Document & {
    __figViewTransition?: { finished: Promise<void> } | null;
  };
  const pending = { finished: previous.promise };
  owner.__figViewTransition = pending;
  const start = vi.spyOn(document, "startViewTransition");
  const prepare = vi.fn();
  const mutate = vi.fn(() => ({
    canceledNames: [],
    cancelRootSnapshot: false,
  }));
  const ready = vi.fn();
  const finished = vi.fn();
  try {
    const capture = viewTransitionHostConfig.commit(
      container,
      { interrupt: false, types: [] },
      prepare,
      mutate,
      ready,
      finished,
    );
    expect(typeof capture).toBe("object");
    if (typeof capture !== "object")
      throw new Error("Expected deferred capture");
    capture.interrupt();
    capture.interrupt();
    expect(mutate).toHaveBeenCalledOnce();
    expect(ready).toHaveBeenCalledExactlyOnceWith(false);
    expect(finished).toHaveBeenCalledOnce();
    expect(owner.__figViewTransition).toBe(pending);
    previous.resolve();
    await waitForHostTurns();
    expect(prepare).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(mutate).toHaveBeenCalledOnce();
  } finally {
    previous.resolve();
    await waitForHostTurns();
    owner.__figViewTransition = null;
    start.mockRestore();
  }
});

it.each([false, true])(
  "queues layout repairs and store notifications until readiness (synchronous update: %s)",
  async (synchronousUpdate) => {
    const container = document.createElement("div");
    document.body.append(container);
    const ready = deferred();
    const finished = deferred();
    const skip = vi.fn();
    let nativeUpdate = () => {};
    const start = vi
      .spyOn(document, "startViewTransition")
      .mockImplementation((input) => {
        const update = typeof input === "function" ? input : input!.update!;
        nativeUpdate = () => {
          void update();
        };
        if (synchronousUpdate) nativeUpdate();
        return {
          ready: ready.promise,
          finished: finished.promise,
          updateCallbackDone: Promise.resolve(),
          types: new Set<string>(),
          skipTransition: skip,
        };
      });
    let select: StateSetter<string> = () => {};
    let snapshot = "old";
    const listeners = new Set<() => void>();
    const subscribe = (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    };
    const onTransition = vi.fn();
    function App() {
      const [panel, setPanel] = useState("initial");
      const [highlight, setHighlight] = useState("initial");
      const value = useSyncExternalStore(subscribe, () => snapshot);
      select = setPanel;
      useBeforePaint(() => {
        setHighlight(panel);
      }, [panel]);
      return createElement(
        ViewTransition,
        { name: "card", onTransition },
        createElement("section", null, `${panel}:${highlight}:${value}`),
      );
    }
    const root = createRoot(container);
    try {
      flushSync(() => root.render(createElement(App)));
      transition(() => select("next"));
      await waitForHostTurns(10);
      expect(start).toHaveBeenCalledOnce();
      if (!synchronousUpdate) nativeUpdate();
      snapshot = "new";
      for (const listener of listeners) listener();
      await waitForHostTurns(10);
      expect(container.textContent).toBe("next:initial:old");
      expect(skip).not.toHaveBeenCalled();
      ready.resolve();
      await ready.promise;
      expect(container.textContent).toBe("next:next:new");
      expect(onTransition).toHaveBeenCalledOnce();
      expect(skip).not.toHaveBeenCalled();
    } finally {
      root.unmount();
      ready.resolve();
      finished.resolve();
      await waitForHostTurns();
      start.mockRestore();
      container.remove();
    }
  },
);

it.each(["before-update", "before-ready"] as const)(
  "keeps repairs isolated across roots during capture %s",
  async (phase) => {
    const container = document.createElement("div");
    const otherContainer = document.createElement("div");
    document.body.append(container, otherContainer);
    const ready = deferred();
    const finished = deferred();
    const skip = vi.fn();
    let nativeUpdate = () => {};
    const start = vi
      .spyOn(document, "startViewTransition")
      .mockImplementation((input) => {
        const update = typeof input === "function" ? input : input!.update!;
        nativeUpdate = () => {
          void update();
        };
        return {
          ready: ready.promise,
          finished: finished.promise,
          updateCallbackDone: Promise.resolve(),
          types: new Set<string>(),
          skipTransition: skip,
        };
      });
    let select: StateSetter<string> = () => {};
    function Other() {
      const [label, setLabel] = useState("old");
      const [repair, setRepair] = useState("old");
      select = setLabel;
      useBeforePaint(() => {
        setRepair(label);
      }, [label]);
      return `${label}:${repair}`;
    }
    const root = createRoot(container);
    const other = createRoot(otherContainer);
    function App({ label }: { label: string }) {
      const [repair, setRepair] = useState("old");
      useBeforePaint(() => {
        setRepair(label);
      }, [label]);
      return createElement(
        ViewTransition,
        { name: "card" },
        createElement("span", null, `${label}:${repair}`),
      );
    }
    const content = (label: string) => createElement(App, { label });
    try {
      flushSync(() => {
        root.render(content("old"));
        other.render(createElement(Other));
      });
      transition(() => root.render(content("next")));
      await waitForHostTurns(10);
      if (phase === "before-ready") nativeUpdate();
      select("new");
      await waitForHostTurns(10);
      expect(otherContainer.textContent).toBe("new:new");
      expect(container.textContent).toBe(
        phase === "before-update" ? "old:old" : "next:old",
      );
      expect(skip).not.toHaveBeenCalled();
      if (phase === "before-update") nativeUpdate();
      ready.resolve();
      await ready.promise;
      // The other root consumed the global flush request; this root must still
      // finish its repair in the readiness callback rather than a later task.
      expect(container.textContent).toBe("next:next");
    } finally {
      root.unmount();
      other.unmount();
      ready.resolve();
      finished.resolve();
      await waitForHostTurns();
      start.mockRestore();
      container.remove();
      otherContainer.remove();
    }
  },
);

it.each(["missing", "throws"] as const)(
  "wakes an existing document waiter on cancellation when native skip %s",
  async (cancellation) => {
    const ready = deferred();
    const finished = deferred();
    const start = vi
      .spyOn(document, "startViewTransition")
      .mockImplementation(() => {
        const native = {
          ready: ready.promise,
          finished: finished.promise,
          updateCallbackDone: Promise.resolve(),
          types: new Set<string>(),
          skipTransition() {
            throw new Error("skip failed");
          },
        };
        if (cancellation === "missing")
          Reflect.deleteProperty(native, "skipTransition");
        return native;
      });
    const resumed = vi.fn();
    try {
      const capture = viewTransitionHostConfig.commit(
        document.createElement("div"),
        { interrupt: false, types: [] },
        () => {},
        () => ({ canceledNames: [], cancelRootSnapshot: false }),
        () => {},
        () => {},
      );
      if (typeof capture !== "object")
        throw new Error("Expected deferred capture");
      expect(
        viewTransitionHostConfig.suspend?.(
          document.createElement("div"),
          { interrupt: false, types: [] },
          resumed,
        ),
      ).toBe(true);
      capture.interrupt();
      await waitForHostTurns();
      expect(resumed).toHaveBeenCalledOnce();
      ready.resolve();
      finished.resolve();
      await waitForHostTurns();
      expect(resumed).toHaveBeenCalledOnce();
    } finally {
      ready.resolve();
      finished.resolve();
      await waitForHostTurns();
      start.mockRestore();
    }
  },
);

it.each(["missing", "throws"] as const)(
  "resumes a second root after rejecting a stale capture when native skip %s",
  async (cancellation) => {
    const container = document.createElement("div");
    const otherContainer = document.createElement("div");
    document.body.append(container, otherContainer);
    const ready = deferred();
    const finished = deferred();
    let rejectStaleCapture = () => {};
    let captures = 0;
    const start = vi
      .spyOn(document, "startViewTransition")
      .mockImplementation((input) => {
        const update = typeof input === "function" ? input : input!.update!;
        captures += 1;
        const first = captures === 1;
        if (first)
          rejectStaleCapture = () => {
            void update();
          };
        else void update();
        const native = {
          ready: first ? ready.promise : Promise.resolve(),
          finished: first ? finished.promise : Promise.resolve(),
          updateCallbackDone: Promise.resolve(),
          types: new Set<string>(),
          skipTransition() {
            throw new Error("skip failed");
          },
        };
        if (cancellation === "missing")
          Reflect.deleteProperty(native, "skipTransition");
        return native;
      });
    let snapshot = "old";
    function Reader({ label }: { label: string }) {
      const value = useSyncExternalStore(
        () => () => {},
        () => snapshot,
      );
      return createElement(
        ViewTransition,
        { name: "first" },
        createElement("span", null, `${label}:${value}`),
      );
    }
    const content = (label: string) =>
      createElement(
        ViewTransition,
        { name: "second" },
        createElement("span", null, label),
      );
    const root = createRoot(container);
    const other = createRoot(otherContainer);
    try {
      flushSync(() => {
        root.render(createElement(Reader, { label: "initial" }));
        other.render(content("initial"));
      });
      transition(() => root.render(createElement(Reader, { label: "next" })));
      await waitForHostTurns(10);
      transition(() => other.render(content("next")));
      await waitForHostTurns(10);
      expect(captures).toBe(1);
      expect(otherContainer.textContent).toBe("initial");
      snapshot = "new";
      rejectStaleCapture();
      // The abandoned native promises remain pending throughout the retry and
      // the second root's commit, including if the retry captures first.
      await waitForHostTurns(20);
      expect(container.textContent).toBe("next:new");
      expect(otherContainer.textContent).toBe("next");
      expect(captures).toBe(3);
    } finally {
      root.unmount();
      other.unmount();
      ready.resolve();
      finished.resolve();
      await waitForHostTurns();
      start.mockRestore();
      container.remove();
      otherContainer.remove();
    }
  },
);

it("wakes a streamed reveal already waiting on a cancelled client capture", async () => {
  const container = document.createElement("div");
  container.innerHTML =
    '<!--fig:suspense:pending:0--><template id="review-boundary"></template><span data-fig-vt-name="card">old</span><!--/fig:suspense--><div id="review-segment"><span data-fig-vt-name="card">new</span></div>';
  document.body.append(container);
  const ready = deferred();
  const finished = deferred();
  let starts = 0;
  const start = vi
    .spyOn(document, "startViewTransition")
    .mockImplementation((input) => {
      const update = typeof input === "function" ? input : input!.update!;
      starts += 1;
      const first = starts === 1;
      if (!first) void update();
      const native = {
        ready: first ? ready.promise : Promise.resolve(),
        finished: first ? finished.promise : Promise.resolve(),
        updateCallbackDone: Promise.resolve(),
        types: new Set<string>(),
        skipTransition() {},
      };
      Reflect.deleteProperty(native, "skipTransition");
      return native;
    });
  const scope: { __figSSR?: { c(boundary: string, segment: string): void } } =
    {};
  // oxlint-disable-next-line typescript-eslint/no-implied-eval
  new Function("document", "globalThis", serverRuntimeCodeFor("__figSSR"))(
    document,
    scope,
  );
  try {
    const capture = viewTransitionHostConfig.commit(
      document.createElement("div"),
      { interrupt: false, types: [] },
      () => {},
      () => ({ canceledNames: [], cancelRootSnapshot: false }),
      () => {},
      () => {},
    );
    if (typeof capture !== "object")
      throw new Error("Expected deferred capture");
    if (scope.__figSSR === undefined)
      throw new Error("Expected server runtime");
    scope.__figSSR.c("review-boundary", "review-segment");
    expect(starts).toBe(1);
    expect(document.getElementById("review-segment")).not.toBeNull();
    capture.interrupt();
    await waitForHostTurns();
    expect(starts).toBe(2);
    expect(document.getElementById("review-segment")).toBeNull();
    expect(container.textContent).toBe("new");
  } finally {
    ready.resolve();
    finished.resolve();
    await waitForHostTurns();
    start.mockRestore();
    container.remove();
  }
});

it.each([false, true])(
  "cleans snapshots before releasing document ownership (cancel throws: %s)",
  async (cancelThrows) => {
    const ready = deferred();
    const finished = deferred();
    const order: string[] = [];
    const container = document.createElement("div");
    const previousName = document.documentElement.style.viewTransitionName;
    const animate = vi
      .spyOn(document.documentElement, "animate")
      .mockImplementation(
        (_frames, options) =>
          ({
            cancel() {
              expect(document.documentElement.style.viewTransitionName).toBe(
                "none",
              );
              const pseudo =
                typeof options === "object" ? options.pseudoElement : undefined;
              order.push(`cancel:${pseudo}`);
              if (cancelThrows)
                throw new Error("animation cancellation failed");
            },
          }) as Animation,
      );
    const start = vi
      .spyOn(document, "startViewTransition")
      .mockImplementation((options) => {
        const update =
          typeof options === "function" ? options : options!.update!;
        void update();
        return {
          ready: ready.promise,
          finished: finished.promise,
          updateCallbackDone: Promise.resolve(),
          types: new Set<string>(),
          skipTransition() {},
        };
      });
    try {
      viewTransitionHostConfig.commit(
        container,
        { interrupt: false, types: [] },
        () => {},
        () => ({ canceledNames: [], cancelRootSnapshot: true }),
        (active) => {
          expect(active).toBe(true);
          expect(animate).toHaveBeenCalledTimes(2);
          order.push("ready");
        },
        () => {
          expect(document.documentElement.style.viewTransitionName).toBe(
            previousName,
          );
          order.push("finished");
          expect(
            viewTransitionHostConfig.suspend?.(
              container,
              { interrupt: false, types: [] },
              () => order.push("resumed"),
            ),
          ).toBe(true);
        },
      );
      ready.resolve();
      await waitForHostTurns();
      expect(order).toEqual(["ready"]);
      expect(document.documentElement.style.viewTransitionName).toBe("none");
      finished.resolve();
      await waitForHostTurns();
      expect(order).toEqual([
        "ready",
        "cancel:::view-transition-group(root)",
        "cancel:::view-transition",
        "finished",
        "resumed",
      ]);
    } finally {
      ready.resolve();
      finished.resolve();
      await waitForHostTurns();
      document.documentElement.style.viewTransitionName = previousName;
      start.mockRestore();
      animate.mockRestore();
    }
  },
);

it.each(["ready", "finished"] as const)(
  "completes cancellation and wakes waiters when the %s callback throws",
  async (throwingCallback) => {
    const ready = deferred();
    const finished = deferred();
    const error = new Error("callback failed");
    const onReady = vi.fn(() => {
      if (typeof capture === "object") capture.interrupt();
      if (throwingCallback === "ready") throw error;
    });
    const onFinished = vi.fn(() => {
      if (throwingCallback === "finished") throw error;
    });
    const resumed = vi.fn();
    const start = vi.spyOn(document, "startViewTransition").mockReturnValue({
      ready: ready.promise,
      finished: finished.promise,
      updateCallbackDone: Promise.resolve(),
      types: new Set<string>(),
      skipTransition() {},
    });
    const container = document.createElement("div");
    const capture = viewTransitionHostConfig.commit(
      container,
      { interrupt: false, types: [] },
      () => {},
      () => ({ canceledNames: [], cancelRootSnapshot: false }),
      onReady,
      onFinished,
    );
    try {
      if (typeof capture !== "object")
        throw new Error("Expected deferred capture");
      expect(
        viewTransitionHostConfig.suspend?.(
          container,
          { interrupt: false, types: [] },
          resumed,
        ),
      ).toBe(true);
      expect(() => capture.interrupt()).toThrow(error);
      await waitForHostTurns();
      expect(onReady).toHaveBeenCalledExactlyOnceWith(false);
      expect(onFinished).toHaveBeenCalledOnce();
      expect(resumed).toHaveBeenCalledOnce();
      ready.resolve();
      finished.resolve();
      await waitForHostTurns();
      expect(onReady).toHaveBeenCalledOnce();
      expect(onFinished).toHaveBeenCalledOnce();
      expect(resumed).toHaveBeenCalledOnce();
    } finally {
      ready.resolve();
      finished.resolve();
      await waitForHostTurns();
      start.mockRestore();
    }
  },
);

it.each(["interrupt", "native-finish"] as const)(
  "ignores snapshot hiding from readiness arriving after %s",
  async (completion) => {
    const ready = deferred();
    const finished = deferred();
    const animate = vi.spyOn(document.documentElement, "animate");
    const onReady = vi.fn();
    const onFinished = vi.fn();
    const start = vi
      .spyOn(document, "startViewTransition")
      .mockImplementation((options) => {
        const update =
          typeof options === "function" ? options : options!.update!;
        void update();
        return {
          ready: ready.promise,
          finished: finished.promise,
          updateCallbackDone: Promise.resolve(),
          types: new Set<string>(),
          skipTransition() {},
        };
      });
    try {
      const capture = viewTransitionHostConfig.commit(
        document.createElement("div"),
        { interrupt: false, types: [] },
        () => {},
        () => ({ canceledNames: ["card"], cancelRootSnapshot: false }),
        onReady,
        onFinished,
      );
      if (typeof capture !== "object")
        throw new Error("Expected deferred capture");
      if (completion === "interrupt") capture.interrupt();
      else finished.resolve();
      await waitForHostTurns();
      ready.resolve();
      finished.resolve();
      await waitForHostTurns();
      expect(animate).not.toHaveBeenCalled();
      expect(onReady).toHaveBeenCalledExactlyOnceWith(false);
      expect(onFinished).toHaveBeenCalledOnce();
    } finally {
      ready.resolve();
      finished.resolve();
      await waitForHostTurns();
      start.mockRestore();
      animate.mockRestore();
    }
  },
);
