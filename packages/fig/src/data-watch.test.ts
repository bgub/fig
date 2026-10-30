import type {
  DataResource,
  DataResourceLoadContext,
  DataResourceWatchContext,
  FigDataReads,
} from "./data.ts";
import { describe, expect, it, vi } from "vitest";
import { dataResource } from "./index.ts";
import { createRendererDataStore } from "./internal.ts";

const flushMicrotasks = () =>
  new Promise<void>((resolve) => setTimeout(resolve));

function clientStore(schedule = vi.fn()) {
  return createRendererDataStore<object, null>({
    getLane: () => null,
    schedule,
    watchSources: true,
  });
}

function read<TArgs extends unknown[], T>(
  store: ReturnType<typeof clientStore>,
  owner: object,
  resource: DataResource<TArgs, T>,
  args: TArgs,
): T {
  const reads: FigDataReads = new Map();
  try {
    return store.readData(resource, args, reads);
  } finally {
    store.commitDataDependencies(owner, null, reads);
  }
}

function watched<T>(load?: () => T | Promise<T>) {
  const contexts: DataResourceWatchContext<T>[] = [];
  const resource = dataResource<[string], T>({
    key: (id) => ["watched", id],
    load: load === undefined ? undefined : () => load(),
    watch: (_id, context) => {
      contexts.push(context);
    },
  });
  return { contexts, resource };
}

describe("watched data resources", () => {
  it("starts a watch only after a committed read, never during render or preload", async () => {
    const { contexts, resource } = watched(() => "loaded");
    const store = clientStore();
    store.hydrate([{ key: ["watched", "a"], value: "hydrated" }]);

    const speculative: FigDataReads = new Map();
    expect(store.readData(resource, ["a"], speculative)).toBe("hydrated");
    store.preloadData(resource, "a");
    await store.ensureData(resource, "a");
    await flushMicrotasks();
    expect(contexts).toHaveLength(0);

    store.commitDataDependencies({}, null, speculative);
    expect(contexts).toHaveLength(0);
    await flushMicrotasks();
    expect(contexts).toHaveLength(1);
    expect(store.inspectDataEntries()[0]?.watching).toBe(true);
    store.dispose();
  });

  it("never starts watches in stores without watch support (server)", async () => {
    const { contexts, resource } = watched(() => "loaded");
    const store = createRendererDataStore<object, null>({
      getLane: () => null,
      schedule: () => undefined,
    });
    store.hydrate([{ key: ["watched", "a"], value: "hydrated" }]);
    const reads: FigDataReads = new Map();
    store.readData(resource, ["a"], reads);
    store.commitDataDependencies({}, null, reads);
    await flushMicrotasks();
    expect(contexts).toHaveLength(0);
    store.dispose();
  });

  it("publishes pushed values to subscribers after hydration commits", async () => {
    const schedule = vi.fn();
    const { contexts, resource } = watched(() => "loaded");
    const store = clientStore(schedule);
    const owner = {};
    store.hydrate([{ key: ["watched", "a"], value: "server" }]);

    expect(read(store, owner, resource, ["a"])).toBe("server");
    await flushMicrotasks();
    contexts[0]?.publish("local");

    expect(schedule).toHaveBeenCalledWith(owner, null);
    expect(read(store, owner, resource, ["a"])).toBe("local");
    store.dispose();
  });

  it("keeps one watch through owner churn and stops it on release", async () => {
    const { contexts, resource } = watched(() => "loaded");
    const store = clientStore();
    const first = {};
    const second = {};
    store.hydrate([{ key: ["watched", "a"], value: "v" }]);

    read(store, first, resource, ["a"]);
    await flushMicrotasks();
    // A replacement owner subscribes in the same turn the old one leaves.
    store.deleteDataOwner(first);
    read(store, second, resource, ["a"]);
    await flushMicrotasks();
    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.signal.aborted).toBe(false);

    store.releaseDataOwner(second);
    await flushMicrotasks();
    expect(contexts[0]?.signal.reason).toBe("released");
    const [entry] = store.inspectDataEntries();
    expect(entry?.stale).toBe(true);
    expect(entry?.watching).toBeUndefined();

    // Publishing after release is inert.
    contexts[0]?.publish("late");
    expect(store.inspectDataEntries()[0]?.value).toBe("v");
    store.dispose();
  });

  it("aborts the watch with the eviction and disposal reasons", async () => {
    const { contexts, resource } = watched(() => "loaded");
    const store = clientStore();
    store.hydrate([{ key: ["watched", "a"], value: "v" }]);
    read(store, {}, resource, ["a"]);
    await flushMicrotasks();
    store.dispose();
    expect(contexts[0]?.signal.reason).toBe("store-disposed");
  });

  it("lets a publish supersede an in-flight load", async () => {
    let resolveLoad: (value: string) => void = () => undefined;
    const { contexts, resource } = watched(
      () =>
        new Promise<string>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const store = clientStore();
    const owner = {};
    store.hydrate([{ key: ["watched", "a"], value: "old" }]);
    read(store, owner, resource, ["a"]);
    await flushMicrotasks();

    const refresh = store.refreshData(resource, "a");
    contexts[0]?.publish("pushed");
    expect(await refresh).toMatchObject({ status: "aborted" });
    resolveLoad("loaded");
    await flushMicrotasks();
    expect(read(store, owner, resource, ["a"])).toBe("pushed");
    store.dispose();
  });

  it("skips publishes the resource considers equal", async () => {
    const schedule = vi.fn();
    const contexts: DataResourceWatchContext<{ n: number }>[] = [];
    const resource = dataResource<[], { n: number }>({
      key: () => ["equal"],
      equals: (a, b) => a.n === b.n,
      load: () => ({ n: 1 }),
      watch: (context) => {
        contexts.push(context);
      },
    });
    const store = clientStore(schedule);
    const owner = {};
    store.hydrate([{ key: ["equal"], value: { n: 1 } }]);
    const first = read(store, owner, resource, []);
    await flushMicrotasks();
    schedule.mockClear();

    contexts[0]?.publish({ n: 1 });
    expect(schedule).not.toHaveBeenCalled();
    expect(read(store, owner, resource, [])).toBe(first);

    contexts[0]?.publish({ n: 2 });
    expect(schedule).toHaveBeenCalledTimes(1);
    store.dispose();
  });

  it("suspends a push-only read until the first publish", async () => {
    const { contexts, resource } = watched<string>();
    const store = clientStore();
    const owner = {};

    let thrown: unknown;
    try {
      read(store, owner, resource, ["a"]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Promise);
    await flushMicrotasks();
    expect(contexts).toHaveLength(1);

    contexts[0]?.publish("first");
    await thrown;
    expect(read(store, owner, resource, ["a"])).toBe("first");
    await flushMicrotasks();
    // The committed reader now owns the same watch.
    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.signal.aborted).toBe(false);
    store.dispose();
  });

  it("treats failures like refresh failures", async () => {
    const { contexts, resource } = watched(() => "loaded");
    const store = clientStore();
    const owner = {};
    store.hydrate([{ key: ["watched", "a"], value: "visible" }]);
    read(store, owner, resource, ["a"]);
    await flushMicrotasks();

    const error = new Error("socket closed");
    contexts[0]?.fail(error);
    expect(read(store, owner, resource, ["a"])).toBe("visible");
    expect(store.inspectDataEntries()[0]?.refreshError).toBe(error);

    const pushOnly = watched<string>();
    try {
      read(store, owner, pushOnly.resource, ["b"]);
    } catch {}
    await flushMicrotasks();
    pushOnly.contexts[0]?.fail(error);
    expect(() => read(store, owner, pushOnly.resource, ["b"])).toThrow(error);
    store.dispose();
  });

  it("converts a synchronously throwing watch into a failure", async () => {
    const error = new Error("boom");
    const resource = dataResource<[], string>({
      key: () => ["throws"],
      load: () => "loaded",
      watch: () => {
        throw error;
      },
    });
    const store = clientStore();
    store.hydrate([{ key: ["throws"], value: "visible" }]);
    read(store, {}, resource, []);
    await flushMicrotasks();
    expect(store.inspectDataEntries()[0]?.refreshError).toBe(error);
    store.dispose();
  });

  it("exposes refresh and invalidate bound to the watched key", async () => {
    let loads = 0;
    const { contexts, resource } = watched(() => `load ${++loads}`);
    const store = clientStore();
    const owner = {};
    store.hydrate([{ key: ["watched", "a"], value: "hydrated" }]);
    read(store, owner, resource, ["a"]);
    await flushMicrotasks();

    await contexts[0]?.refresh();
    expect(read(store, owner, resource, ["a"])).toBe("load 1");

    contexts[0]?.invalidate();
    expect(store.inspectDataEntries()[0]?.stale).toBe(true);
    store.dispose();
  });

  it("keeps the visible value when a reload is equal", async () => {
    const schedule = vi.fn();
    const signals: AbortSignal[] = [];
    let version = 1;
    const resource = dataResource<[], { n: number }>({
      key: () => ["equal-reload"],
      equals: (a, b) => a.n === b.n,
      load: ({ signal }) => {
        signals.push(signal);
        return { n: version };
      },
    });
    const store = clientStore(schedule);
    const owner = {};
    await store.ensureData(resource);
    const first = read(store, owner, resource, []);
    store.invalidateData(resource);
    schedule.mockClear();

    const result = await store.refreshData(resource);
    expect(result).toEqual({ status: "fulfilled", value: first });
    expect(schedule).not.toHaveBeenCalled();
    expect(read(store, owner, resource, [])).toBe(first);
    expect(store.inspectDataEntries()[0]?.stale).toBe(false);
    // The original generation stays authoritative; the equal one retires.
    expect(signals[0]?.aborted).toBe(false);
    expect(signals[1]?.reason).toBe("superseded");

    version = 2;
    await store.refreshData(resource);
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(read(store, owner, resource, [])).toEqual({ n: 2 });
    expect(signals[0]?.reason).toBe("superseded");
    store.dispose();
  });

  it("re-reads a notification-only source through refresh", async () => {
    const schedule = vi.fn();
    const rows = ["a"];
    const notify = new EventTarget();
    const resource = dataResource<[], string[]>({
      key: () => ["notified"],
      equals: (a, b) => a.join() === b.join(),
      load: () => [...rows],
      watch: ({ refresh, signal }) => {
        notify.addEventListener("change", refresh, { signal });
      },
    });
    const store = clientStore(schedule);
    const owner = {};
    await store.ensureData(resource);
    read(store, owner, resource, []);
    await flushMicrotasks();
    schedule.mockClear();

    // A change notification for rows this key does not show re-renders nothing.
    notify.dispatchEvent(new Event("change"));
    await flushMicrotasks();
    expect(schedule).not.toHaveBeenCalled();

    rows.push("b");
    notify.dispatchEvent(new Event("change"));
    await flushMicrotasks();
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(read(store, owner, resource, [])).toEqual(["a", "b"]);
    store.dispose();
  });

  it("treats identical values as unchanged by default", async () => {
    const schedule = vi.fn();
    const shared = { n: 1 };
    const contexts: DataResourceWatchContext<{ n: number }>[] = [];
    const resource = dataResource<[], { n: number }>({
      key: () => ["identical"],
      load: () => shared,
      watch: (context) => {
        contexts.push(context);
      },
    });
    const store = clientStore(schedule);
    const owner = {};
    await store.ensureData(resource);
    read(store, owner, resource, []);
    await flushMicrotasks();
    schedule.mockClear();

    contexts[0]?.publish(shared);
    await store.refreshData(resource);
    expect(schedule).not.toHaveBeenCalled();

    contexts[0]?.publish({ n: 1 });
    expect(schedule).toHaveBeenCalledTimes(1);
    store.dispose();
  });
});

describe("per-resource retention", () => {
  function retained(inactiveRetentionMs?: number) {
    const signals: AbortSignal[] = [];
    const resource = dataResource<[], string>({
      key: () => ["retained", String(inactiveRetentionMs)],
      inactiveRetentionMs,
      load: ({ signal }) => {
        signals.push(signal);
        return "value";
      },
    });
    return { resource, signals };
  }

  it("overrides the store's inactive retention for its own entries", async () => {
    vi.useFakeTimers();
    try {
      const store = createRendererDataStore<object, null>({
        getLane: () => null,
        inactiveRetentionMs: 60_000,
        schedule: () => undefined,
        watchSources: true,
      });
      const short = retained(1_000);
      const forever = retained(Number.POSITIVE_INFINITY);
      const fallback = retained();
      for (const { resource } of [short, forever, fallback]) {
        const owner = {};
        read(store, owner, resource, []);
        store.releaseDataOwner(owner);
      }

      vi.advanceTimersByTime(1_000);
      expect(short.signals[0]?.reason).toBe("evicted");
      expect(fallback.signals[0]?.aborted).toBe(false);

      vi.advanceTimersByTime(59_000);
      expect(fallback.signals[0]?.reason).toBe("evicted");

      vi.advanceTimersByTime(24 * 60 * 60 * 1_000);
      expect(forever.signals[0]?.aborted).toBe(false);
      expect(store.inspectDataEntries()).toHaveLength(1);
      store.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies to hydrated entries once a resource reads them", () => {
    vi.useFakeTimers();
    try {
      const store = clientStore();
      const { resource } = retained(500);
      store.hydrate([{ key: ["retained", "500"], value: "server" }]);
      const owner = {};
      read(store, owner, resource, []);
      store.releaseDataOwner(owner);
      vi.advanceTimersByTime(500);
      expect(store.inspectDataEntries()).toHaveLength(0);
      store.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("watch review fixes", () => {
  it("keeps the visible generation when an equal publish lands during a refresh", async () => {
    const schedule = vi.fn();
    const signals: AbortSignal[] = [];
    const shared = { rows: ["a"] };
    let resolveRefresh: (value: { rows: string[] }) => void = () => undefined;
    const contexts: DataResourceWatchContext<{ rows: string[] }>[] = [];
    const resource = dataResource<[], { rows: string[] }>({
      key: () => ["equal-during-refresh"],
      load: ({ signal }) => {
        signals.push(signal);
        if (signals.length === 1) return shared;
        return new Promise((resolve) => {
          resolveRefresh = resolve;
        });
      },
      watch: (context) => {
        contexts.push(context);
      },
    });
    const store = clientStore(schedule);
    const owner = {};
    await store.ensureData(resource);
    read(store, owner, resource, []);
    await flushMicrotasks();
    schedule.mockClear();

    const refresh = store.refreshData(resource);
    contexts[0]?.publish(shared);

    expect(await refresh).toMatchObject({
      status: "aborted",
      reason: "superseded",
    });
    expect(signals[0]?.aborted).toBe(false);
    expect(signals[1]?.reason).toBe("superseded");
    expect(schedule).not.toHaveBeenCalled();
    resolveRefresh({ rows: ["late"] });
    await flushMicrotasks();
    expect(read(store, owner, resource, [])).toBe(shared);
    store.dispose();
  });

  it("clears failure state when an equal value is published", async () => {
    const { contexts, resource } = watched(() => "loaded");
    const store = clientStore();
    const owner = {};
    store.hydrate([{ key: ["watched", "a"], value: "visible" }]);
    read(store, owner, resource, ["a"]);
    await flushMicrotasks();

    contexts[0]?.fail(new Error("socket closed"));
    expect(store.inspectDataEntries()[0]).toMatchObject({ stale: true });
    contexts[0]?.publish("visible");
    const [entry] = store.inspectDataEntries();
    expect(entry?.refreshError).toBeUndefined();
    expect(entry?.stale).toBe(false);
    store.dispose();
  });

  it("stops a push-only watch when the read that started it is discarded", async () => {
    const store = clientStore();
    const { contexts, resource } = watched<string>();
    const reads: FigDataReads = new Map();
    let suspended: unknown;
    try {
      store.readData(resource, ["a"], reads);
    } catch (thenable) {
      suspended = thenable;
    }
    await flushMicrotasks();
    expect(contexts).toHaveLength(1);

    // The render attempt is thrown away without committing.
    store.releaseDataReads(reads);
    await flushMicrotasks();
    expect(contexts[0]?.signal.reason).toBe("released");
    expect(store.inspectDataEntries()).toHaveLength(0);
    // The suspended reader is woken rather than left waiting forever.
    await expect(suspended).resolves.toMatchObject({ status: "aborted" });
    store.dispose();
  });

  it("lets a fallback boundary hold a slow push-only watch indefinitely", async () => {
    vi.useFakeTimers();
    try {
      const schedule = vi.fn();
      const store = clientStore(schedule);
      const { contexts, resource } = watched<string>();
      const child = {};
      const boundary = {};
      const childReads: FigDataReads = new Map();
      expect(() => store.readData(resource, ["a"], childReads)).toThrow();
      // Suspense takes the suspended read over, discards the child's attempt,
      // and commits its fallback.
      const boundaryReads: FigDataReads = new Map();
      for (const [key] of childReads) store.holdDataRead(boundaryReads, key);
      store.releaseDataReads(childReads);
      store.commitDataDependencies(boundary, null, boundaryReads);
      await vi.advanceTimersByTimeAsync(10 * 60 * 1_000);
      expect(contexts).toHaveLength(1);
      expect(contexts[0]?.signal.aborted).toBe(false);

      // The first value wakes the boundary; the revealed child subscribes and
      // the boundary lets go, without restarting the watch.
      contexts[0]?.publish("first");
      expect(schedule).toHaveBeenCalledWith(boundary, null);
      expect(read(store, child, resource, ["a"])).toBe("first");
      store.commitDataDependencies(boundary, boundary);
      await vi.advanceTimersByTimeAsync(0);
      expect(contexts).toHaveLength(1);
      expect(contexts[0]?.signal.aborted).toBe(false);

      store.releaseDataOwner(child);
      await vi.advanceTimersByTimeAsync(0);
      expect(contexts[0]?.signal.reason).toBe("released");
      store.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops a held push-only watch when its fallback boundary unmounts", async () => {
    const store = clientStore();
    const { contexts, resource } = watched<string>();
    const boundary = {};
    const childReads: FigDataReads = new Map();
    expect(() => store.readData(resource, ["a"], childReads)).toThrow();
    const boundaryReads: FigDataReads = new Map();
    for (const [key] of childReads) store.holdDataRead(boundaryReads, key);
    store.releaseDataReads(childReads);
    store.commitDataDependencies(boundary, null, boundaryReads);
    await flushMicrotasks();
    expect(contexts[0]?.signal.aborted).toBe(false);

    store.releaseDataOwner(boundary);
    await flushMicrotasks();
    // Nothing else waits for a value, so the entry itself is discarded.
    expect(contexts[0]?.signal.reason).toBe("evicted");
    expect(store.inspectDataEntries()).toHaveLength(0);
    store.dispose();
  });

  it("resolves watch refresh() with the refresh outcome", async () => {
    let loads = 0;
    const { contexts, resource } = watched(() => `load ${++loads}`);
    const store = clientStore();
    const owner = {};
    store.hydrate([{ key: ["watched", "a"], value: "hydrated" }]);
    read(store, owner, resource, ["a"]);
    await flushMicrotasks();

    expect(await contexts[0]?.refresh()).toEqual({
      status: "fulfilled",
      value: "load 1",
    });
    store.releaseDataOwner(owner);
    await flushMicrotasks();
    expect(await contexts[0]?.refresh()).toMatchObject({
      status: "aborted",
      reason: "released",
    });

    const pushOnly = watched<string>();
    try {
      read(store, owner, pushOnly.resource, ["b"]);
    } catch {}
    await flushMicrotasks();
    expect(await pushOnly.contexts[0]?.refresh()).toMatchObject({
      status: "unsupported",
    });
    store.dispose();
  });
});

describe("data handle in load and watch", () => {
  function connectionAndRows() {
    const connectionSignals: AbortSignal[] = [];
    const connection = dataResource<[string], { rows: string[] }>({
      key: (user) => ["connection", user],
      inactiveRetentionMs: 1_000,
      load: (_user, { signal }) => {
        connectionSignals.push(signal);
        return { rows: ["a", "b"] };
      },
    });
    const rows = dataResource<[string], string[]>({
      key: (user) => ["rows", user],
      inactiveRetentionMs: 1_000,
      load: async (user, { data }) =>
        (await data.ensureData(connection, user)).rows,
      watch: (user, { data, publish, signal }) => {
        void data.ensureData(connection, user).then((open) => {
          if (!signal.aborted) publish(open.rows);
        });
      },
    });
    return { connection, connectionSignals, rows };
  }

  it("keeps an ensured dependency cached while the dependent is visible", async () => {
    vi.useFakeTimers();
    try {
      const store = clientStore();
      const { connectionSignals, rows } = connectionAndRows();
      const owner = {};
      await store.ensureData(rows, "ben");
      expect(read(store, owner, rows, ["ben"])).toEqual(["a", "b"]);
      await vi.advanceTimersByTimeAsync(60_000);
      // Nothing reads the connection directly, but the rows still need it.
      expect(connectionSignals[0]?.aborted).toBe(false);

      store.releaseDataOwner(owner);
      // Rows evict after their retention, which releases the connection,
      // which then evicts after its own retention.
      await vi.advanceTimersByTimeAsync(1_000);
      expect(connectionSignals[0]?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(connectionSignals[0]?.reason).toBe("evicted");
      expect(store.inspectDataEntries()).toHaveLength(0);
      store.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs dependent loads against the request store on the server", async () => {
    const store = createRendererDataStore<object, null>({
      getLane: () => null,
      schedule: () => undefined,
    });
    const { rows } = connectionAndRows();
    expect(await store.ensureData(rows, "ben")).toEqual(["a", "b"]);
    expect(
      store
        .snapshot()
        .map((entry) => entry.key[0])
        .sort(),
    ).toEqual(["connection", "rows"]);
    store.dispose();
  });
});

describe("ownership across cancellation and eviction", () => {
  it("ends a dependent's wait when its parent stops", async () => {
    const store = clientStore();
    const feed = watched<string>();
    const parentContexts: DataResourceWatchContext<string>[] = [];
    const parent = dataResource<[], string>({
      key: () => ["parent"],
      load: () => "parent",
      watch: (context) => {
        parentContexts.push(context);
      },
    });
    const owner = {};
    await store.ensureData(parent);
    read(store, owner, parent, []);
    await flushMicrotasks();
    const wait = parentContexts[0]?.data.ensureData(feed.resource, "a");
    await flushMicrotasks();
    expect(feed.contexts).toHaveLength(1);

    store.releaseDataOwner(owner);
    await expect(wait).rejects.toBe("released");
    await flushMicrotasks();
    // Nothing else waited for the feed, so its watch stopped with it.
    expect(feed.contexts[0]?.signal.aborted).toBe(true);
    expect(
      store.inspectDataEntries().some((entry) => entry.key[0] === "watched"),
    ).toBe(false);
    store.dispose();
  });

  it("rejects a retired watch's dependency read without creating an entry", async () => {
    const store = clientStore();
    const { contexts, resource } = watched(() => "parent");
    const load = vi.fn(() => "value");
    const dependency = dataResource({
      key: () => ["late-dependency"],
      load,
    });
    const owner = {};
    try {
      read(store, owner, resource, ["parent"]);
      await flushMicrotasks();
      const context = contexts[0]!;
      store.releaseDataOwner(owner);
      await flushMicrotasks();
      expect(context.signal.reason).toBe("released");

      await expect(context.data.ensureData(dependency)).rejects.toBe(
        "released",
      );
      expect(load).not.toHaveBeenCalled();
      expect(
        store
          .inspectDataEntries()
          .filter((entry) => entry.key[0] === "late-dependency"),
      ).toEqual([]);
    } finally {
      store.dispose();
    }
  });

  it("rejects a retired loader's dependency read without creating an entry", async () => {
    const store = clientStore();
    const contexts: DataResourceLoadContext[] = [];
    const parent = dataResource({
      key: () => ["parent"],
      load: (context) => {
        contexts.push(context);
        return contexts.length;
      },
    });
    const load = vi.fn(() => "value");
    const dependency = dataResource({
      key: () => ["late-dependency"],
      load,
    });
    try {
      await expect(store.ensureData(parent)).resolves.toBe(1);
      const context = contexts[0]!;
      await expect(store.refreshData(parent)).resolves.toEqual({
        status: "fulfilled",
        value: 2,
      });
      expect(context.signal.reason).toBe("superseded");

      await expect(context.data.ensureData(dependency)).rejects.toBe(
        "superseded",
      );
      expect(load).not.toHaveBeenCalled();
      expect(
        store
          .inspectDataEntries()
          .filter((entry) => entry.key[0] === "late-dependency"),
      ).toEqual([]);
    } finally {
      store.dispose();
    }
  });

  it("does not cancel other callers waiting on the same dependency", async () => {
    const store = clientStore();
    const feed = watched<string>();
    const parentContexts: DataResourceWatchContext<string>[] = [];
    const parent = dataResource<[], string>({
      key: () => ["parent"],
      load: () => "parent",
      watch: (context) => {
        parentContexts.push(context);
      },
    });
    const other = store.ensureData(feed.resource, "a");
    const owner = {};
    await store.ensureData(parent);
    read(store, owner, parent, []);
    await flushMicrotasks();
    const parentWait = parentContexts[0]?.data.ensureData(feed.resource, "a");

    store.releaseDataOwner(owner);
    await expect(parentWait).rejects.toBe("released");
    await flushMicrotasks();
    expect(feed.contexts).toHaveLength(1);
    expect(feed.contexts[0]?.signal.aborted).toBe(false);
    feed.contexts[0]?.publish("value");
    await expect(other).resolves.toBe("value");
    store.dispose();
  });

  it.each(["published", "hydrated"])(
    "restarts a push-only dependency's watch when a dependent acquires its %s value",
    async (origin) => {
      const store = clientStore();
      const feed = watched<string>();
      if (origin === "published") {
        const first = store.ensureData(feed.resource, "a");
        await flushMicrotasks();
        feed.contexts[0]?.publish("cached");
        await first;
        await flushMicrotasks();
        // The caller finished, so the watch stopped and left a stale value.
        expect(feed.contexts[0]?.signal.reason).toBe("released");
      } else {
        store.hydrate([{ key: ["watched", "a"], value: "cached" }]);
      }
      const watchesBefore = feed.contexts.length;

      const parentContexts: DataResourceWatchContext<string>[] = [];
      const parent = dataResource<[], string>({
        key: () => ["parent"],
        load: () => "parent",
        watch: (context) => {
          parentContexts.push(context);
        },
      });
      const owner = {};
      await store.ensureData(parent);
      read(store, owner, parent, []);
      await flushMicrotasks();
      await expect(
        parentContexts[0]?.data.ensureData(feed.resource, "a"),
      ).resolves.toBe("cached");
      await flushMicrotasks();
      expect(feed.contexts).toHaveLength(watchesBefore + 1);
      const restarted = feed.contexts.at(-1);
      expect(restarted?.signal.aborted).toBe(false);
      restarted?.publish("fresh");
      expect(
        store.inspectDataEntries().find((e) => e.key[0] === "watched"),
      ).toMatchObject({ value: "fresh", watching: true });

      // Retiring the dependent releases the watch again.
      store.releaseDataOwner(owner);
      await flushMicrotasks();
      expect(restarted?.signal.reason).toBe("released");
      store.dispose();
    },
  );

  it("does not evict an entry an uncommitted render still holds", async () => {
    const store = clientStore();
    const { contexts, resource } = watched<string>();
    const boundary = {};
    const pendingReads: FigDataReads = new Map();
    expect(() => store.readData(resource, ["a"], pendingReads)).toThrow();
    // A committed boundary also waits on the key...
    const boundaryReads: FigDataReads = new Map();
    for (const [key] of pendingReads) store.holdDataRead(boundaryReads, key);
    store.commitDataDependencies(boundary, null, boundaryReads);
    await flushMicrotasks();

    // ...and goes away while the other render is still in progress.
    store.releaseDataOwner(boundary);
    await flushMicrotasks();
    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.signal.aborted).toBe(false);
    expect(store.inspectDataEntries()).toHaveLength(1);

    store.releaseDataReads(pendingReads);
    await flushMicrotasks();
    expect(contexts[0]?.signal.aborted).toBe(true);
    expect(store.inspectDataEntries()).toHaveLength(0);
    store.dispose();
  });

  it("keeps a held value through inactive cleanup", async () => {
    vi.useFakeTimers();
    try {
      const store = clientStore();
      const contexts: DataResourceWatchContext<string>[] = [];
      const resource = dataResource<[], string>({
        key: () => ["held-value"],
        inactiveRetentionMs: 0,
        watch: (context) => {
          contexts.push(context);
        },
      });
      const reads: FigDataReads = new Map();
      expect(() => store.readData(resource, [], reads)).toThrow();
      await vi.advanceTimersByTimeAsync(0);
      contexts[0]?.publish("value");
      await vi.advanceTimersByTimeAsync(1_000);
      expect(store.inspectDataEntries()[0]?.value).toBe("value");

      store.releaseDataReads(reads);
      await vi.advanceTimersByTimeAsync(0);
      expect(store.inspectDataEntries()).toHaveLength(0);
      store.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
