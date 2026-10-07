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
import { createRoot, flushSync } from "./index.ts";
import { viewTransitionHostConfig } from "./view-transition.ts";
import { enableViewTransitions } from "./view-transitions.ts";
import { waitForHostTurns } from "./test-utils.ts";

enableViewTransitions();

const nativeStart = Object.getOwnPropertyDescriptor(
  document,
  "startViewTransition",
);
beforeEach(() => {
  Object.defineProperty(document, "startViewTransition", {
    configurable: true,
    writable: true,
    value: () => {},
  });
});
afterEach(() => {
  if (nativeStart)
    Object.defineProperty(document, "startViewTransition", nativeStart);
  else Reflect.deleteProperty(document, "startViewTransition");
});

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("cancels a synchronously rejected capture after acquiring its native handle", async () => {
  const ready = deferred();
  const finished = deferred();
  const skip = vi.fn();
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
