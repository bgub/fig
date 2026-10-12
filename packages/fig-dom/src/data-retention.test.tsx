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
import { FakeElement, installFakeDocument } from "./test-utils.ts";

installFakeDocument();
const retentionMs = 5 * 60 * 1000;

it.each(["initial", "pushed"])(
  "evicts unclaimed %s hydration after the inactive retention window",
  (source) => {
    vi.useFakeTimers();
    const entries = [{ key: ["unused"] as const, value: "server value" }];
    const store = createDataStore({
      initialData: source === "initial" ? entries : undefined,
    });
    const root = createRoot(new FakeElement("root") as unknown as Element, {
      dataStore: store,
    });
    try {
      flushSync(() => root.render("elsewhere"));
      if (source === "pushed") store.hydrate(entries);
      vi.advanceTimersByTime(retentionMs - 1);
      expect(store.snapshot()).toEqual(entries);
      vi.advanceTimersByTime(1);
      expect(store.snapshot()).toEqual([]);
    } finally {
      flushSync(() => root.unmount());
      vi.useRealTimers();
    }
  },
);

it("evicts a cached value read by a discarded Suspense render", async () => {
  vi.useFakeTimers();
  const store = createDataStore();
  const signals = new Map<string, AbortSignal>();
  const resource = dataResource({
    key: (id: string) => ["value", id],
    load: (id: string, { signal }) => {
      signals.set(id, signal);
      return id;
    },
  });
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element, {
    dataStore: store,
  });
  const never = new Promise<never>(() => undefined);
  function Reader() {
    readData(resource, "abandoned");
    return readPromise(never);
  }
  try {
    await store.refreshData(resource, "control");
    await store.refreshData(resource, "abandoned");
    flushSync(() =>
      root.render(
        createElement(Suspense, { fallback: "loading" }, createElement(Reader)),
      ),
    );
    expect(container.textContent).toBe("loading");
    flushSync(() => root.render("elsewhere"));
    vi.advanceTimersByTime(retentionMs - 1);
    expect(signals.get("abandoned")?.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(store.snapshot()).toEqual([]);
    expect(signals.get("control")?.reason).toBe("evicted");
    expect(signals.get("abandoned")?.reason).toBe("evicted");
  } finally {
    flushSync(() => root.unmount());
    vi.useRealTimers();
  }
});

it("retains a committed hydrated value until its reader unmounts", () => {
  vi.useFakeTimers();
  const entries = [{ key: ["claimed"] as const, value: "server value" }];
  const store = createDataStore({ initialData: entries });
  const resource = dataResource<[], string>({ key: () => ["claimed"] });
  const root = createRoot(new FakeElement("root") as unknown as Element, {
    dataStore: store,
  });
  function Reader() {
    return createElement("span", null, readData(resource));
  }
  try {
    flushSync(() => root.render(createElement(Reader)));
    vi.advanceTimersByTime(retentionMs * 2);
    expect(store.snapshot()).toEqual(entries);
    flushSync(() => root.render("elsewhere"));
    vi.advanceTimersByTime(retentionMs);
    expect(store.snapshot()).toEqual([]);
  } finally {
    flushSync(() => root.unmount());
    vi.useRealTimers();
  }
});
