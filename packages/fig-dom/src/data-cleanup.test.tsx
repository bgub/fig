import {
  createDataStore,
  createElement,
  dataResource,
  readData,
  Suspense,
} from "@bgub/fig";
import { expect, it, vi } from "vitest";
import { createRoot, flushSync } from "./index.ts";
import { deferred, FakeElement, installFakeDocument } from "./test-utils.ts";

installFakeDocument();

it("evicts an expiring cached value after its Suspense render is abandoned", async () => {
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
    flushSync(() => root.render("elsewhere"));
    vi.advanceTimersByTime(60 * 1000 - 1);
    expect(store.snapshot()).toHaveLength(1);
    expect(valueSignal?.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(store.snapshot()).toEqual([]);
    expect(valueSignal?.reason).toBe("evicted");
  } finally {
    flushSync(() => root.unmount());
    vi.useRealTimers();
  }
});
