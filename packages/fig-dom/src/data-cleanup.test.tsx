import {
  createDataStore,
  createElement,
  dataResource,
  readData,
  readPromise,
  Suspense,
} from "@bgub/fig";
import { expect, it, vi } from "vitest";
import { createRoot, flushSync } from "./index.ts";
import { deferred, FakeElement, installFakeDocument } from "./test-utils.ts";

installFakeDocument();

it("holds a cached value while its boundary waits and evicts it once abandoned", async () => {
  vi.useFakeTimers();
  const store = createDataStore();
  const pending = deferred<void>();
  let valueSignal: AbortSignal | undefined;
  const resource = dataResource({
    key: () => ["abandoned-cached-value"],
    load: ({ signal }) => {
      valueSignal = signal;
      return "cached";
    },
  });
  function Reader(): never {
    readData(resource);
    throw pending.promise;
  }
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element, {
    dataStore: store,
  });
  try {
    await store.refreshData(resource);
    vi.advanceTimersByTime(4 * 60 * 1000);
    flushSync(() =>
      root.render(
        createElement(Suspense, { fallback: "loading" }, createElement(Reader)),
      ),
    );
    expect(container.textContent).toBe("loading");
    // The boundary takes over its suspended content's reads, so the value
    // outlives its original deadline while the fallback waits.
    vi.advanceTimersByTime(2 * 60 * 1000);
    expect(store.snapshot()).toHaveLength(1);
    // Abandoning the boundary releases the hold and re-arms a full window.
    flushSync(() => root.render("elsewhere"));
    vi.advanceTimersByTime(5 * 60 * 1000 - 1);
    expect(store.snapshot()).toHaveLength(1);
    expect(valueSignal?.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(store.snapshot()).toEqual([]);
    expect(valueSignal?.reason).toBe("evicted");
  } finally {
    flushSync(() => root.unmount());
    // Drain work the scheduler queued on fake timers before restoring them.
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  }
});

it("keeps a hydrate-only value while its boundary waits on other work", async () => {
  vi.useFakeTimers();
  const store = createDataStore({
    initialData: [{ key: ["waiting-user"], value: "Ada" }],
  });
  const slow = deferred<void>();
  const user = dataResource<[], string>({
    inactiveRetentionMs: 100,
    key: () => ["waiting-user"],
  });
  function Profile() {
    const name = readData(user);
    readPromise(slow.promise);
    return createElement("p", null, name);
  }
  const errors: unknown[] = [];
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element, {
    dataStore: store,
    onUncaughtError: (error) => errors.push(error),
  });
  try {
    flushSync(() =>
      root.render(
        createElement(
          Suspense,
          { fallback: "loading" },
          createElement(Profile),
        ),
      ),
    );
    expect(container.textContent).toBe("loading");
    // The waiting boundary holds the value past its retention window.
    vi.advanceTimersByTime(1000);
    expect(store.snapshot()).toEqual([{ key: ["waiting-user"], value: "Ada" }]);
    slow.resolve();
    // The retry reveals after the fallback throttle.
    await vi.advanceTimersByTimeAsync(1000);
    expect(container.textContent).toBe("Ada");
    expect(errors).toEqual([]);
  } finally {
    flushSync(() => root.unmount());
    vi.useRealTimers();
  }
});
