import {
  createElement,
  readPromise,
  Suspense,
  createDataStore,
  dataResource,
  readData,
  useSyncExternalStore,
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

it.each(["hydrate", "refresh", "unchanged"])(
  "rebuilds sibling data reads across repeated suspension (%s)",
  async (update) => {
    const gate = deferred<void>();
    const secondGate = deferred<void>();
    let value = "old";
    const resource = dataResource<[], string>({
      key: () => ["suspense-data"],
      load: () => value,
    });
    const store = createDataStore({
      initialData: [{ key: ["suspense-data"], value: "old" }],
    });
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element, {
      dataStore: store,
    });
    function Reader() {
      return readData(resource);
    }
    function Pending() {
      readPromise(gate.promise);
      readPromise(secondGate.promise);
      return "ready";
    }
    try {
      flushSync(() =>
        root.render(
          createElement(
            Suspense,
            { fallback: "waiting" },
            createElement("section", null, createElement(Reader)),
            createElement(Pending),
          ),
        ),
      );
      expect(container.textContent).toBe("waiting");
      async function updateData(next: string) {
        value = next;
        if (update === "refresh") await store.refreshData(resource);
        else store.hydrate([{ key: ["suspense-data"], value: next }]);
      }
      if (update !== "unchanged") await updateData("new");
      gate.resolve();
      await waitForHostTurns();
      expect(container.textContent).toBe("waiting");
      if (update !== "unchanged") await updateData("newest");
      secondGate.resolve();
      await waitForHostTurns();
      expect(container.textContent).toBe(
        update === "unchanged" ? "oldready" : "newestready",
      );
      // A reader must subscribe even if its value did not change while suspended.
      await updateData("after-reveal");
      await waitForHostTurns();
      expect(container.textContent).toBe("after-revealready");
    } finally {
      flushSync(() => root.unmount());
    }
  },
);

it("rebuilds a sibling external-store snapshot and subscription before reveal", async () => {
  const gate = deferred<void>();
  const listeners = new Set<() => void>();
  let value = "old";
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const getSnapshot = () => value;
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element);
  function Reader() {
    return useSyncExternalStore(subscribe, getSnapshot);
  }
  function Pending() {
    readPromise(gate.promise);
    return "ready";
  }
  try {
    flushSync(() =>
      root.render(
        createElement(
          Suspense,
          { fallback: "waiting" },
          createElement("section", null, createElement(Reader)),
          createElement(Pending),
        ),
      ),
    );
    expect(container.textContent).toBe("waiting");
    expect(listeners.size).toBe(0);
    value = "new";
    gate.resolve();
    await waitForHostTurns();
    expect(container.textContent).toBe("newready");
    expect(listeners.size).toBe(1);
    flushSync(() => {
      value = "after-reveal";
      for (const listener of listeners) listener();
    });
    expect(container.textContent).toBe("after-revealready");
  } finally {
    flushSync(() => root.unmount());
  }
  expect(listeners.size).toBe(0);
});
