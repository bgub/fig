import {
  createElement,
  transition,
  ViewTransition,
  ErrorBoundary,
  useBeforeLayout,
  useBeforePaint,
  useStableEvent,
  useSyncExternalStore,
  useState,
  type StateSetter,
} from "@bgub/fig";
import { afterEach, expect, it } from "vitest";
import { createRoot, flushSync, type FigRoot } from "./index.ts";
import {
  FakeElement,
  FakeText,
  installFakeDocument,
  waitForHostTurns,
} from "./test-utils.ts";
import { createRenderer } from "../../fig-reconciler/src/index.ts";
import { createViewTransitionCommitCoordinator } from "../../fig-reconciler/src/view-transitions.ts";
import { requestPaint } from "../../fig-reconciler/src/scheduler.ts";
import type { ReconcilerCommitContext } from "../../fig-reconciler/src/commit-coordinator.ts";

installFakeDocument();
const roots: FigRoot[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) flushSync(() => root.unmount());
});

it.each([false, true])(
  "never exposes torn snapshots after yielding (sync continuation: %s)",
  async (syncContinuation) => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    roots.push(root);
    const commits: string[] = [];
    let value = "old";
    let shouldYield = true;
    const subscribe = () => () => {};
    const getSnapshot = () => value;
    function Reader() {
      return createElement(
        "span",
        null,
        useSyncExternalStore(subscribe, getSnapshot),
      );
    }
    function YieldToStoreUpdate() {
      if (shouldYield) {
        shouldYield = false;
        requestPaint();
        queueMicrotask(() => {
          value = "new";
          if (syncContinuation) flushSync(() => {});
        });
      }
      return null;
    }
    function App() {
      useBeforePaint(() => {
        commits.push(container.textContent);
      });
      return createElement(
        "main",
        null,
        createElement(Reader),
        createElement(YieldToStoreUpdate),
        createElement(Reader),
      );
    }
    root.render(createElement(App));
    await waitForHostTurns(15);
    expect(container.textContent).toBe("newnew");
    expect(commits.length).toBeGreaterThan(0);
    expect(commits).not.toContain("oldnew");
  },
);

it("routes snapshot errors from subscriptions through the nearest error boundary", () => {
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element);
  roots.push(root);
  const failure = new Error("store snapshot failed");
  const caught: unknown[] = [];
  const listeners = new Set<() => void>();
  let fail = false;
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const getSnapshot = () => {
    if (fail) throw failure;
    return "ready";
  };
  function Reader() {
    return createElement(
      "span",
      null,
      useSyncExternalStore(subscribe, getSnapshot),
    );
  }
  flushSync(() =>
    root.render(
      createElement(
        ErrorBoundary,
        {
          fallback: createElement("span", null, "recovered"),
          onError: (error) => {
            caught.push(error);
          },
        },
        createElement(Reader),
      ),
    ),
  );
  fail = true;
  expect(() => {
    for (const listener of listeners) listener();
  }).not.toThrow();
  flushSync(() => {});
  expect(container.textContent).toBe("recovered");
  expect(caught).toEqual([failure]);
});

it("revalidates store snapshots after a coordinator parks a finished render", async () => {
  const renderer = createAuditRenderer();
  const container = new FakeElement("root");
  const root = renderer.createRoot(container);
  let blocked = true;
  let ready = () => {};
  let value = "old";
  const commits: string[] = [];
  renderer.installCommitCoordinator({
    name: "external-store-audit",
    suspend: (_root, onReady) => {
      ready = onReady;
      return blocked;
    },
    commit: () => false,
  });
  function Reader() {
    const snapshot = useSyncExternalStore(
      () => () => {},
      () => value,
    );
    useBeforePaint(() => {
      commits.push(container.textContent);
    });
    return createElement("span", null, snapshot);
  }
  try {
    renderer.flushSync(() => root.render(createElement(Reader)));
    expect(container.textContent).toBe("");
    value = "new";
    blocked = false;
    ready();
    await waitForHostTurns(10);
    expect(container.textContent).toBe("new");
    expect(commits).not.toContain("old");
  } finally {
    blocked = false;
    renderer.flushSync(() => root.unmount());
  }
});

it("retires an external-store listener before invoking its unsubscribe callback", () => {
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element);
  roots.push(root);
  let readsDuringTeardown = 0;
  let tearingDown = false;
  const subscribe = (notify: () => void) => () => {
    tearingDown = true;
    notify();
  };
  function Reader() {
    const value = useSyncExternalStore(subscribe, () => {
      if (tearingDown) readsDuringTeardown += 1;
      return "value";
    });
    return createElement("span", null, value);
  }
  flushSync(() => root.render(createElement(Reader)));
  flushSync(() => root.unmount());
  roots.splice(roots.indexOf(root), 1);
  expect(readsDuringTeardown).toBe(0);
});

it("invokes a throwing unsubscribe only once while clearing the root", () => {
  const container = new FakeElement("root");
  const errors: unknown[] = [];
  const root = createRoot(container as unknown as Element, {
    onUncaughtError: (error) => errors.push(error),
  });
  roots.push(root);
  let cleanups = 0;
  const failure = new Error("unsubscribe failed");
  const subscribe = () => () => {
    cleanups += 1;
    throw failure;
  };
  function Reader() {
    return createElement(
      "span",
      null,
      useSyncExternalStore(subscribe, () => "value"),
    );
  }
  flushSync(() => root.render(createElement(Reader)));
  expect(() => flushSync(() => root.unmount())).toThrow(failure);
  roots.splice(roots.indexOf(root), 1);
  expect(cleanups).toBe(1);
  expect(errors).toEqual([failure]);
  expect(container.textContent).toBe("");
});

function createAuditRenderer() {
  return createRenderer<FakeElement, FakeElement, FakeText>({
    createInstance: (type) => new FakeElement(type),
    createTextInstance: (text) => new FakeText(text),
    appendInitialChild: (parent, child) => {
      parent.insertBefore(child, null);
    },
    finalizeInitialInstance: () => {},
    insertBefore: (parent, child, before) => {
      parent.insertBefore(child, before);
    },
    removeChild: (parent, child) => {
      parent.removeChild(child);
    },
    commitUpdate: () => {},
    commitTextUpdate: (text, value) => {
      text.nodeValue = value;
    },
  });
}

it("keeps late capture callbacks from resetting a newer commit", () => {
  const renderer = createAuditRenderer();
  const container = new FakeElement("root");
  const errors: unknown[] = [];
  const root = renderer.createRoot(container, {
    onUncaughtError: (error) => errors.push(error),
  });
  const capture: { current?: ReconcilerCommitContext<FakeElement> } = {};
  let defer = true;
  renderer.installCommitCoordinator({
    name: "candidate-identity",
    commit(context) {
      if (!defer) return false;
      capture.current = context;
      return {
        interrupt() {
          context.runMutation(() => undefined);
          context.captureFinished();
        },
      };
    },
  });
  try {
    renderer.flushSync(() => root.render(createElement("span", null, "first")));
    const first = capture.current;
    expect(first?.runMutation(() => undefined)).toEqual({
      kind: "committed",
      value: undefined,
    });
    first?.captureFinished();
    defer = false;
    renderer.flushSync(() =>
      root.render(createElement("span", null, "second")),
    );
    first?.captureFinished();
    expect(() => first?.runMutation(() => undefined)).toThrow("only once");
    expect(container.textContent).toBe("second");
    expect(errors).toEqual([]);
  } finally {
    defer = false;
    renderer.flushSync(() => root.unmount());
  }
});

it("returns an explicit failure after reporting a deferred mutation error", () => {
  const renderer = createAuditRenderer();
  const container = new FakeElement("root");
  const errors: unknown[] = [];
  const root = renderer.createRoot(container, {
    onUncaughtError: (error) => errors.push(error),
  });
  const capture: { current?: ReconcilerCommitContext<FakeElement> } = {};
  let defer = true;
  renderer.installCommitCoordinator({
    name: "candidate-failure",
    commit(context) {
      if (!defer) return false;
      capture.current = context;
      return {
        interrupt() {
          context.runMutation(() => undefined);
          context.captureFinished();
        },
      };
    },
  });
  try {
    renderer.flushSync(() => root.render(createElement("span", null, "first")));
    const failure = new Error("capture failed");
    expect(
      capture.current?.runMutation(() => {
        throw failure;
      }),
    ).toEqual({ kind: "failed" });
    expect(errors).toEqual([failure]);
    expect(container.textContent).toBe("");
    capture.current?.captureFinished();
  } finally {
    defer = false;
    renderer.flushSync(() => root.unmount());
  }
});

it("does not expose stale store snapshots when a deferred mutation finally runs", () => {
  const renderer = createAuditRenderer();
  const container = new FakeElement("root");
  const root = renderer.createRoot(container);
  let deferred: (() => void) | undefined;
  let value = "old";
  let defer = true;
  const captures: string[] = [];
  renderer.installCommitCoordinator({
    name: "deferred-store-audit",
    commit(context) {
      if (!defer) return false;
      deferred = () => {
        context.runMutation(() => {
          captures.push(`${container.textContent}:${value}`);
        });
        context.captureFinished();
      };
      return {
        interrupt() {
          context.runMutation(() => undefined);
          context.captureFinished();
        },
      };
    },
  });
  function Reader() {
    return createElement(
      "span",
      null,
      useSyncExternalStore(
        () => () => {},
        () => value,
      ),
    );
  }
  try {
    renderer.flushSync(() => root.render(createElement(Reader)));
    value = "new";
    defer = false;
    deferred?.();
    renderer.flushSync(() => {});
    expect(container.textContent).toBe("new");
    expect(captures).toEqual([]);
  } finally {
    defer = false;
    renderer.flushSync(() => root.unmount());
  }
});

it("retires the previous store before replacing its subscription", () => {
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element);
  roots.push(root);
  let oldStoreRetired = false;
  let retiredReads = 0;
  const subscribeOld = (notify: () => void) => () => {
    oldStoreRetired = true;
    notify();
  };
  const getOld = () => {
    if (oldStoreRetired) retiredReads += 1;
    return "old";
  };
  const subscribeNew = () => () => {};
  const getNew = () => "new";
  function Reader({ changed }: { changed: boolean }) {
    return createElement(
      "span",
      null,
      useSyncExternalStore(
        changed ? subscribeNew : subscribeOld,
        changed ? getNew : getOld,
      ),
    );
  }
  flushSync(() => root.render(createElement(Reader, { changed: false })));
  flushSync(() => root.render(createElement(Reader, { changed: true })));
  expect(container.textContent).toBe("new");
  expect(retiredReads).toBe(0);
});

it("keeps committed event handlers and before-layout effects unchanged until deferred mutation", () => {
  const renderer = createAuditRenderer();
  const container = new FakeElement("root");
  const root = renderer.createRoot(container);
  let defer = false;
  let finish = () => {};
  let read = () => "not mounted";
  const effects: string[] = [];
  renderer.installCommitCoordinator({
    name: "deferred-hooks-audit",
    commit(context) {
      if (!defer) return false;
      finish = () => {
        context.runMutation(() => {});
        context.captureFinished();
      };
      return {
        interrupt() {
          context.runMutation(() => undefined);
          context.captureFinished();
        },
      };
    },
  });
  function App({ label }: { label: string }) {
    read = useStableEvent(() => label);
    useBeforeLayout(() => {
      effects.push(label);
    }, [label]);
    return createElement("span", null, label);
  }
  try {
    renderer.flushSync(() => root.render(createElement(App, { label: "old" })));
    effects.length = 0;
    defer = true;
    renderer.flushSync(() => root.render(createElement(App, { label: "new" })));
    expect(container.textContent).toBe("old");
    expect(read()).toBe("old");
    expect(effects).toEqual([]);
    defer = false;
    finish();
    expect(container.textContent).toBe("new");
    expect(read()).toBe("new");
    expect(effects).toEqual(["new"]);
  } finally {
    defer = false;
    renderer.flushSync(() => root.unmount());
  }
});

it.each([false, true])(
  "restores view-transition styles and dispatches callbacks only for committed store renders (snapshot changed: %s)",
  async (snapshotChanged) => {
    const renderer = createAuditRenderer();
    const container = new FakeElement("root");
    const root = renderer.createRoot(container);
    let value = "old";
    let defer = true;
    let finish = () => {};
    let callbackCalls = 0;
    const firstStyle = {
      viewTransitionName: "authored-old",
      viewTransitionClass: "old-class",
    };
    const secondStyle = {
      viewTransitionName: "authored-new",
      viewTransitionClass: "new-class",
    };
    const restoredStyles: unknown[] = [];
    const results: Array<{
      canceledNames: string[];
      cancelRootSnapshot: boolean;
    }> = [];
    const listeners = new Set<() => void>();
    const subscribe = (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    };
    renderer.installCommitCoordinator(
      createViewTransitionCommitCoordinator<FakeElement, FakeElement>({
        apply: () => {},
        restore: (_instance, props) => {
          restoredStyles.push(props.style);
        },
        commit: (_container, _options, prepare, mutate, ready, finished) => {
          if (!defer) return false;
          prepare();
          finish = () => {
            results.push(mutate());
            ready(true);
            finished();
          };
          return {
            interrupt() {
              mutate();
              ready(false);
              finished();
            },
          };
        },
      }),
    );
    function App({ label }: { label: string }) {
      const snapshot = useSyncExternalStore(subscribe, () => value);
      return createElement(
        ViewTransition,
        {
          name: "card",
          update: "fade",
          onTransition: () => {
            callbackCalls += 1;
          },
        },
        createElement(
          "span",
          { style: label === "first:" ? firstStyle : secondStyle },
          label,
          snapshot,
        ),
      );
    }
    try {
      renderer.flushSync(() =>
        root.render(createElement(App, { label: "first:" })),
      );
      transition(() => root.render(createElement(App, { label: "second:" })));
      await waitForHostTurns(10);
      expect(container.textContent).toBe("first:old");
      expect(restoredStyles).toEqual([]);
      expect(callbackCalls).toBe(0);
      if (snapshotChanged) {
        value = "new";
        for (const listener of listeners) listener();
      }
      // Store notifications remain queued until capture release.
      expect(container.textContent).toBe("first:old");
      defer = false;
      finish();
      expect(results).toEqual([
        {
          canceledNames: [],
          cancelRootSnapshot: true,
          ...(snapshotChanged ? { cancelTransition: true } : {}),
        },
      ]);
      expect(container.textContent).toBe(
        // Release flushes the queued store update with committed root props;
        // the rejected transition props are replayed separately below.
        snapshotChanged ? "first:new" : "second:old",
      );
      expect(restoredStyles).toEqual([
        snapshotChanged ? firstStyle : secondStyle,
      ]);
      expect(callbackCalls).toBe(snapshotChanged ? 0 : 1);
      await waitForHostTurns(10);
      expect(container.textContent).toBe(
        snapshotChanged ? "second:new" : "second:old",
      );
    } finally {
      defer = false;
      renderer.flushSync(() => root.unmount());
    }
  },
);

it("replays a rejected deferred render and its late updates exactly once", () => {
  const renderer = createAuditRenderer();
  const container = new FakeElement("root");
  const root = renderer.createRoot(container);
  let set: StateSetter<number> = () => {};
  let snapshot = "old";
  let defer = false;
  let finish = () => {};
  const captures: string[] = [];
  renderer.installCommitCoordinator({
    name: "deferred-queue-audit",
    commit(context) {
      if (!defer) return false;
      let completed = false;
      finish = () => {
        if (completed) return;
        completed = true;
        context.runMutation(() => captures.push(container.textContent));
        context.captureFinished();
      };
      return { interrupt: finish };
    },
  });
  function Counter() {
    const [count, update] = useState(1);
    set = update;
    const value = useSyncExternalStore(
      () => () => {},
      () => snapshot,
    );
    return createElement("span", null, `${count}:${value}`);
  }
  try {
    renderer.flushSync(() => root.render(createElement(Counter)));
    defer = true;
    renderer.flushSync(() => set((value) => value * 10));
    expect(container.textContent).toBe("1:old");
    snapshot = "new";
    defer = false;
    renderer.flushSync(() => set((value) => value + 1));
    finish();
    renderer.flushSync(() => {});
    expect(container.textContent).toBe("11:new");
    expect(captures).toEqual([]);
  } finally {
    defer = false;
    renderer.flushSync(() => root.unmount());
  }
});
