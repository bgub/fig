import { describe, expect, it, vi } from "vitest";
import {
  createDataStore,
  createRendererDataStore,
  dataResource,
} from "./data-store.ts";
import {
  loadContextCapabilities,
  type DataRefreshResult,
  type LoadContextAttributeError,
} from "./data.ts";

const never = new Promise<never>(() => undefined);

describe("data load lifecycle", () => {
  it("keeps a refresh started by a superseded loader's abort listener authoritative", async () => {
    const store = createDataStore({
      initialData: [{ key: ["value"], value: "initial" }],
    });
    let calls = 0;
    let nested: Promise<DataRefreshResult<string>> | undefined;
    const resource = dataResource<[], string>({
      key: () => ["value"],
      load: ({ signal }) => {
        calls += 1;
        if (calls === 1) {
          signal.addEventListener("abort", () => {
            nested = store.refreshData(resource);
          });
          return never;
        }
        return `load-${calls}`;
      },
    });
    try {
      const first = store.refreshData(resource);
      const second = store.refreshData(resource);
      expect(store.snapshot()).toEqual([{ key: ["value"], value: "load-2" }]);
      await expect(first).resolves.toMatchObject({ status: "aborted" });
      await expect(second).resolves.toMatchObject({ status: "aborted" });
      await expect(nested).resolves.toEqual({
        status: "fulfilled",
        value: "load-2",
      });
    } finally {
      store.dispose();
    }
  });

  it("keeps a recovery refresh started when a failed loader is aborted", async () => {
    const store = createRendererDataStore<object, null>({
      getLane: () => null,
      schedule: () => undefined,
    });
    store.hydrate([{ key: ["value"], value: "initial" }]);
    const error = new Error("failed");
    let calls = 0;
    let nested: Promise<DataRefreshResult<string>> | undefined;
    const resource = dataResource<[], string>({
      key: () => ["value"],
      load: ({ signal }) => {
        if (++calls === 1) {
          signal.addEventListener("abort", () => {
            nested = store.refreshData(resource);
          });
          throw error;
        }
        return "recovered";
      },
    });
    try {
      const failed = await store.refreshData(resource);
      expect(failed).toEqual({
        status: "rejected",
        error,
        staleValue: "initial",
      });
      await expect(nested).resolves.toEqual({
        status: "fulfilled",
        value: "recovered",
      });
      expect(store.snapshot()).toEqual([
        { key: ["value"], value: "recovered" },
      ]);
      // A successful recovery must not inherit the preceding refresh error.
      expect(store.inspectDataEntries()[0]).toMatchObject({
        stale: false,
        refreshError: undefined,
      });
    } finally {
      store.dispose();
    }
  });

  it("publishes hydration before calling the retired generation's abort listener", async () => {
    const store = createDataStore();
    let nested: Promise<DataRefreshResult<string>> | undefined;
    let calls = 0;
    const signals: AbortSignal[] = [];
    const resource = dataResource<[], string>({
      key: () => ["value"],
      load: ({ signal }) => {
        signals.push(signal);
        if (++calls === 1)
          signal.addEventListener("abort", () => {
            nested = store.refreshData(resource);
          });
        return `load-${calls}`;
      },
    });
    try {
      await store.refreshData(resource);
      store.hydrate([{ key: ["value"], value: "hydrated" }]);
      await expect(nested).resolves.toEqual({
        status: "fulfilled",
        value: "load-2",
      });
      expect(store.snapshot()).toEqual([{ key: ["value"], value: "load-2" }]);
      expect(signals.map((signal) => signal.aborted)).toEqual([true, false]);
    } finally {
      store.dispose();
    }
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("does not erase a replacement entry created by an eviction abort listener", async () => {
    vi.useFakeTimers();
    const store = createRendererDataStore<object, null>({
      getLane: () => null,
      schedule: () => undefined,
      inactiveRetentionMs: 10,
    });
    let nested: Promise<DataRefreshResult<string>> | undefined;
    let calls = 0;
    const resource = dataResource<[], string>({
      key: () => ["value"],
      load: ({ signal }) => {
        if (++calls === 1)
          signal.addEventListener("abort", () => {
            nested = store.refreshData(resource);
          });
        return `load-${calls}`;
      },
    });
    try {
      await store.refreshData(resource);
      vi.advanceTimersByTime(10);
      await expect(nested).resolves.toEqual({
        status: "fulfilled",
        value: "load-2",
      });
      expect(store.snapshot()).toEqual([{ key: ["value"], value: "load-2" }]);
    } finally {
      store.dispose();
      vi.useRealTimers();
    }
  });

  it("preserves recovery started while an attributed value error is invalidated", async () => {
    const store = createDataStore();
    const error = new Error("stream failed");
    let attributeError: LoadContextAttributeError | undefined;
    let nested: Promise<DataRefreshResult<string>> | undefined;
    let calls = 0;
    const resource = dataResource<[], string>({
      key: () => ["value"],
      load: (context) => {
        if (++calls === 1) {
          attributeError = loadContextCapabilities(context)?.attributeError;
          context.signal.addEventListener("abort", () => {
            nested = store.refreshData(resource);
          });
        }
        return `load-${calls}`;
      },
    });
    try {
      await store.refreshData(resource);
      attributeError?.(error);
      expect(store.invalidateDataError(error)).toBe(true);
      await expect(nested).resolves.toEqual({
        status: "fulfilled",
        value: "load-2",
      });
      expect(store.snapshot()).toEqual([{ key: ["value"], value: "load-2" }]);
    } finally {
      store.dispose();
    }
  });

  it("settles and aborts the pending replacement when the store is disposed", async () => {
    const store = createDataStore({
      initialData: [{ key: ["value"], value: "initial" }],
    });
    const signals: AbortSignal[] = [];
    let nested: Promise<DataRefreshResult<string>> | undefined;
    const resource = dataResource<[], string>({
      key: () => ["value"],
      load: ({ signal }) => {
        signals.push(signal);
        if (signals.length === 1)
          signal.addEventListener("abort", () => {
            nested = store.refreshData(resource);
          });
        return never;
      },
    });
    const first = store.refreshData(resource);
    const second = store.refreshData(resource);
    expect(signals).toHaveLength(2);
    expect(signals.map((signal) => signal.aborted)).toEqual([true, false]);
    store.dispose();
    await expect(first).resolves.toMatchObject({
      status: "aborted",
      reason: "superseded",
    });
    await expect(second).resolves.toMatchObject({
      status: "aborted",
      reason: "superseded",
    });
    await expect(nested).resolves.toMatchObject({
      status: "aborted",
      reason: "store-disposed",
    });
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("skips a successor's loader if the predecessor's abort listener disposes the store", async () => {
    const store = createDataStore({
      initialData: [{ key: ["value"], value: "initial" }],
    });
    let calls = 0;
    const resource = dataResource<[], string>({
      key: () => ["value"],
      load: ({ signal }) => {
        calls += 1;
        signal.addEventListener("abort", () => store.dispose());
        return never;
      },
    });
    const first = store.refreshData(resource);
    const second = store.refreshData(resource);
    await expect(first).resolves.toMatchObject({
      status: "aborted",
      reason: "superseded",
    });
    await expect(second).resolves.toMatchObject({
      status: "aborted",
      reason: "store-disposed",
    });
    expect(calls).toBe(1);
  });

  it("stops a hydration batch when retiring an earlier entry disposes the store", async () => {
    const store = createDataStore();
    const resource = dataResource<[], string>({
      key: () => ["first"],
      load: ({ signal }) => {
        signal.addEventListener("abort", () => store.dispose());
        return "initial";
      },
    });
    await store.refreshData(resource);
    store.hydrate([
      { key: ["first"], value: "replacement" },
      { key: ["second"], value: "must not register" },
    ]);
    expect(store.snapshot()).toEqual([
      { key: ["first"], value: "replacement" },
    ]);
  });

  it("settles a loader whose then getter throws as a rejected refresh", async () => {
    const store = createDataStore();
    const error = new Error("then getter failed");
    const resource = dataResource<[], string>({
      key: () => ["value"],
      load: () =>
        // Deliberately malformed thenable exercises the loader assimilation boundary.
        // oxlint-disable-next-line unicorn/no-thenable
        Object.defineProperty({}, "then", {
          get() {
            throw error;
          },
        }) as PromiseLike<string>,
    });
    try {
      await expect(store.refreshData(resource)).resolves.toEqual({
        status: "rejected",
        error,
      });
    } finally {
      store.dispose();
    }
  });
});
