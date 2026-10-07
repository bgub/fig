// @vitest-environment happy-dom
import {
  Activity,
  createDataStore,
  createElement,
  dataResource,
  ErrorBoundary,
  readData,
  readPromise,
  Suspense,
  transition,
  useState,
  useSyncExternalStore,
  ViewTransition,
  type StateSetter,
} from "@bgub/fig";
import type { FigDataStore, FigDataReads } from "@bgub/fig/internal";
import { expect, it } from "vitest";
import { createRoot, flushSync, hydrateRoot } from "./index.ts";
import { domRenderer } from "./renderer.ts";
import { createViewTransitionCommitCoordinator } from "../../fig-reconciler/src/view-transitions.ts";
import { waitForHostTurns } from "./test-utils.ts";

let defer = false;
const pending: Array<() => void> = [];
domRenderer.installCommitCoordinator(
  createViewTransitionCommitCoordinator({
    apply: () => {},
    restore: () => {},
    commit(_container, _options, prepare, mutate, ready, finished) {
      if (!defer) return false;
      prepare();
      pending.push(() => {
        mutate();
        ready(true);
        finished();
      });
      return "deferred";
    },
  }),
);

it("rebuilds data observations and subscriptions after a discarded initial primary", async () => {
  const controller = createDataStore({
    initialData: [{ key: ["retry"], value: "initial" }],
  });
  const resource = dataResource<[], string>({ key: () => ["retry"] });
  let resolve: () => void = () => {};
  const pendingRead = new Promise<void>((done) => {
    resolve = done;
  });
  function Reader() {
    return createElement("span", null, readData(resource));
  }
  function Wait() {
    readPromise(pendingRead);
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container, { dataStore: controller });
  try {
    flushSync(() =>
      root.render(
        createElement(
          Suspense,
          { fallback: "loading" },
          createElement(Reader),
          createElement(Wait),
        ),
      ),
    );
    expect(container.textContent).toBe("loading");
    controller.hydrate([{ key: ["retry"], value: "retried" }]);
    resolve();
    await waitForHostTurns(10);
    expect(container.textContent).toBe("retried");
    flushSync(() => controller.hydrate([{ key: ["retry"], value: "updated" }]));
    expect(container.textContent).toBe("updated");
  } finally {
    flushSync(() => root.unmount());
  }
});

it.each([false, true])(
  "commits server snapshots while validating client reads during deferred Activity hydration (client changed: %s)",
  async (changeClientSnapshot) => {
    const container = document.createElement("div");
    container.innerHTML =
      "<div>hidden:old</div><template data-fig-activity><span>server</span></template>";
    let setMode: StateSetter<"visible" | "hidden"> = () => {};
    let clientSnapshot = "old";
    const subscribe = () => () => {};
    function Reader() {
      const value = useSyncExternalStore(
        () => () => {},
        () => "client",
        () => "server",
      );
      return createElement("span", null, value);
    }
    function App() {
      const [mode, set] = useState<"visible" | "hidden">("hidden");
      setMode = set;
      const snapshot = useSyncExternalStore(
        subscribe,
        () => clientSnapshot,
        () => "old",
      );
      return [
        createElement(
          ViewTransition,
          { name: "status" },
          createElement("div", null, `${mode}:${snapshot}`),
        ),
        createElement(Activity, { mode }, createElement(Reader)),
      ];
    }
    const template = container.querySelector("template");
    const serverSpan = template?.content.firstChild;
    const root = hydrateRoot(container, createElement(App));
    flushSync(() => {});
    try {
      defer = true;
      transition(() => setMode("visible"));
      await waitForHostTurns(10);
      expect(pending.length).toBe(1);
      if (changeClientSnapshot) clientSnapshot = "new";
      pending.shift()?.();
      await waitForHostTurns(10);
      if (changeClientSnapshot) {
        expect(container.textContent).toBe("hidden:old");
        expect(container.querySelector("template")).toBe(template);
        expect(pending).toHaveLength(1);
        pending.shift()?.();
        await waitForHostTurns(10);
      }
      expect(pending).toHaveLength(0);
      expect(container.querySelector("template")).toBeNull();
      expect(container.textContent).toBe(`visible:${clientSnapshot}client`);
      expect(container.querySelector("span")).toBe(serverSpan);
    } finally {
      defer = false;
      pending.shift()?.();
      flushSync(() => root.unmount());
    }
  },
);

it.each(["preserve", "fallback", "error"])(
  "releases speculative data reads when a boundary discards a primary (%s)",
  async (mode) => {
    const controller = createDataStore({
      initialData: [
        { key: ["review", "current"], value: { label: "current" } },
        { key: ["review", "speculative"], value: { label: "discarded" } },
      ],
    });
    const store = controller as FigDataStore;
    const read = store.readData.bind(store);
    const observations: FigDataReads[] = [];
    store.readData = (resource, args, reads) => {
      if (reads !== undefined) observations.push(reads);
      return read(resource, args, reads);
    };
    const resource = dataResource<[string], { label: string }>({
      key: (key) => ["review", key],
    });
    let set: StateSetter<boolean> = () => {};
    const forever = new Promise<never>(() => {});
    function Reader() {
      const [suspend, update] = useState(false);
      readData(resource, suspend ? "speculative" : "current");
      set = update;
      if (suspend)
        throw mode === "error" ? new Error("failed render") : forever;
      return createElement("span", null, "ready");
    }
    const container = document.createElement("div");
    const root = createRoot(container, { dataStore: controller });
    try {
      flushSync(() =>
        root.render(
          createElement(
            ErrorBoundary,
            { fallback: "failed" },
            createElement(
              Suspense,
              { fallback: "loading" },
              createElement(Reader),
            ),
          ),
        ),
      );
      observations.length = 0;
      if (mode === "preserve") transition(() => set(true));
      else flushSync(() => set(true));
      await waitForHostTurns(10);
      expect(container.textContent).toBe(
        mode === "preserve"
          ? "ready"
          : mode === "fallback"
            ? "readyloading"
            : "failed",
      );
      expect(observations.length).toBeGreaterThan(0);
      store.hydrate([
        { key: ["review", "speculative"], value: { label: "replacement" } },
      ]);
      // Replacing this unsubscribed key cannot wake the suspended reader. The
      // old object should now be releasable, instead of surviving in its map.
      expect(observations.every((reads) => reads.size === 0)).toBe(true);
    } finally {
      flushSync(() => root.unmount());
    }
  },
);
