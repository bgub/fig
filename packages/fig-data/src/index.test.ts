import { describe, expect, it } from "vite-plus/test";
import {
  dataResource,
  invalidateData,
  preloadData,
  refreshData,
} from "./index.ts";
import { createDataStore } from "./internal.ts";

const never = new Promise<never>(() => undefined);

describe("@bgub/fig-data", () => {
  it("passes store context to loaders", async () => {
    const messageResource = dataResource<[string], string, { prefix: string }>({
      key: (id) => ["message", id],
      load: (id, { context }) => `${context.prefix}${id}`,
    });
    const store = createDataStore<object, null>({
      context: { prefix: "hello-" },
      getLane: () => null,
      schedule: () => undefined,
    });

    await expect(store.refreshData(messageResource, "one")).resolves.toEqual({
      status: "fulfilled",
      value: "hello-one",
    });
  });

  it("evicts inactive fulfilled entries after their retention window", async () => {
    const evicted: string[] = [];
    const owner = {};
    const labelResource = dataResource({
      key: (id: string) => ["label", id],
      load: () => "ready",
    });
    const store = createDataStore<object, null>({
      context: {},
      getLane: () => null,
      inactiveRetentionMs: 0,
      onEntryEvict: (entry) => evicted.push(entry.canonicalKey),
      schedule: () => undefined,
    });

    expect(store.readData(labelResource, ["one"], owner)).toBe("ready");
    store.commitDataDependencies(owner, null);
    store.deleteDataOwner(owner);
    await delay();

    expect(evicted).toEqual(['["label","one"]']);
  });

  it("drops dependencies from abandoned render attempts on reset", () => {
    const scheduled: object[] = [];
    const owner = {};
    const resource = dataResource({
      key: (id: string) => ["reset", id],
      load: (id: string) => id,
    });
    const store = createDataStore<object, null>({
      context: {},
      getLane: () => null,
      schedule: (subscriber) => scheduled.push(subscriber),
    });

    // First render attempt reads "a", then is abandoned before commit. The
    // work-in-progress owner is reused, so the next attempt starts with a reset.
    expect(store.readData(resource, ["a"], owner)).toBe("a");
    store.resetDataDependencies(owner);
    expect(store.readData(resource, ["b"], owner)).toBe("b");
    store.commitDataDependencies(owner, null);

    const byKey = new Map(
      store.inspectDataEntries().map((entry) => [entry.canonicalKey, entry]),
    );
    expect(byKey.get('["reset","a"]')?.subscriberCount).toBe(0);
    expect(byKey.get('["reset","b"]')?.subscriberCount).toBe(1);

    // The owner no longer reads "a", so invalidating it must not schedule it.
    store.invalidateData(resource, "a");
    expect(scheduled).toEqual([]);

    store.invalidateData(resource, "b");
    expect(scheduled).toEqual([owner]);
  });

  it("aborts abandoned preloads after their grace window", async () => {
    const signals: AbortSignal[] = [];
    const evicted: string[] = [];
    const pendingResource = dataResource({
      key: (id: string) => ["pending", id],
      load: (_id: string, { signal }) => {
        signals.push(signal);
        return never;
      },
    });
    const store = createDataStore<object, null>({
      context: {},
      getLane: () => null,
      inactiveRetentionMs: Number.POSITIVE_INFINITY,
      onEntryEvict: (entry) => evicted.push(entry.canonicalKey),
      preloadRetentionMs: 0,
      schedule: () => undefined,
    });

    store.run(() => preloadData(pendingResource, "one"));
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);

    await delay();

    expect(signals[0]?.aborted).toBe(true);
    expect(evicted).toEqual(['["pending","one"]']);
  });

  it("settles pending refresh callers when the store is disposed", async () => {
    const pendingResource = dataResource({
      key: (id: string) => ["dispose", id],
      load: () => never,
    });
    const store = createDataStore<object, null>({
      context: {},
      getLane: () => null,
      schedule: () => undefined,
    });

    const result = store.refreshData(pendingResource, "one");
    store.dispose();

    await expect(result).resolves.toEqual({
      reason: "store-disposed",
      staleValue: undefined,
      status: "aborted",
    });
  });

  it("refreshes unobserved keys eagerly", async () => {
    let loads = 0;
    const valueResource = dataResource({
      key: (id: string) => ["unobserved-refresh", id],
      load: () => {
        loads += 1;
        return "ready";
      },
    });
    const store = createDataStore<object, null>({
      context: {},
      getLane: () => null,
      schedule: () => undefined,
    });

    await expect(
      store.run(() => refreshData(valueResource, "one")),
    ).resolves.toEqual({
      status: "fulfilled",
      value: "ready",
    });
    expect(loads).toBe(1);
  });

  it("invalidates unobserved keys lazily", async () => {
    let loads = 0;
    const valueResource = dataResource({
      key: (id: string) => ["unobserved-invalidate", id],
      load: () => {
        loads += 1;
        return `value-${loads}`;
      },
    });
    const store = createDataStore<object, null>({
      context: {},
      getLane: () => null,
      schedule: () => undefined,
    });

    await store.refreshData(valueResource, "one");
    store.run(() => invalidateData(valueResource, "one"));
    await delay();

    expect(loads).toBe(1);
  });

  it("does not create entries for unsupported refreshes with no value", async () => {
    const changes: string[] = [];
    const hydrateOnlyResource = dataResource.identity<[string], string>({
      key: (id) => ["hydrate-only-missing", id],
    });
    const store = createDataStore<object, null>({
      context: {},
      getLane: () => null,
      onEntryChange: (entry) => changes.push(entry.canonicalKey),
      schedule: () => undefined,
    });

    await expect(
      store.run(() => refreshData(hydrateOnlyResource, "one")),
    ).resolves.toEqual({
      reason: "no-client-loader",
      status: "unsupported",
    });
    expect(changes).toEqual([]);
  });

  it("supersedes older fulfilled-value refreshes", async () => {
    const firstRefresh = deferred<string>();
    const secondRefresh = deferred<string>();
    const refreshes = [firstRefresh, secondRefresh];
    let loads = 0;
    const owner = {};
    const valueResource = dataResource({
      key: (id: string) => ["superseded-refresh", id],
      load: () => {
        loads += 1;
        if (loads === 1) return "initial";

        const next = refreshes.shift();
        if (next === undefined) throw new Error("Unexpected refresh.");
        return next.promise;
      },
    });
    const store = createDataStore<object, null>({
      context: {},
      getLane: () => null,
      schedule: () => undefined,
    });

    expect(store.readData(valueResource, ["one"], owner)).toBe("initial");
    store.commitDataDependencies(owner, null);

    const first = store.refreshData(valueResource, "one");
    const second = store.refreshData(valueResource, "one");

    await expect(first).resolves.toEqual({
      reason: "superseded",
      staleValue: "initial",
      status: "aborted",
    });

    secondRefresh.resolve("updated");

    await expect(second).resolves.toEqual({
      status: "fulfilled",
      value: "updated",
    });
  });

  it("does not auto-retry a stale entry after a failed background refresh", async () => {
    let loads = 0;
    let failNext = false;
    const owner = {};
    const valueResource = dataResource({
      key: (id: string) => ["refresh-fail", id],
      load: () => {
        loads += 1;
        if (failNext) return Promise.reject(new Error("boom"));
        return "value";
      },
    });
    const store = createDataStore<object, null>({
      context: {},
      getLane: () => null,
      schedule: () => undefined,
    });

    expect(store.readData(valueResource, ["one"], owner)).toBe("value");
    store.commitDataDependencies(owner, null);
    expect(loads).toBe(1);

    // A failing background refresh keeps the stale value but must not retry on
    // every subsequent read.
    failNext = true;
    store.invalidateData(valueResource, "one");
    expect(store.readData(valueResource, ["one"], owner)).toBe("value");
    await delay();
    expect(loads).toBe(2);

    expect(store.readData(valueResource, ["one"], owner)).toBe("value");
    expect(store.readData(valueResource, ["one"], owner)).toBe("value");
    expect(loads).toBe(2);

    // An explicit invalidation is a fresh intent and re-enables auto-refresh.
    failNext = false;
    store.invalidateData(valueResource, "one");
    expect(store.readData(valueResource, ["one"], owner)).toBe("value");
    await delay();
    expect(loads).toBe(3);
  });

  it("aborts an in-flight load when its last subscriber is released", () => {
    const signals: AbortSignal[] = [];
    const owner = {};
    const pendingResource = dataResource({
      key: (id: string) => ["release-abort", id],
      load: (_id: string, { signal }) => {
        signals.push(signal);
        return never;
      },
    });
    const store = createDataStore<object, null>({
      context: {},
      getLane: () => null,
      schedule: () => undefined,
    });

    expect(() => store.readData(pendingResource, ["one"], owner)).toThrow();
    store.commitDataDependencies(owner, null);
    expect(signals[0]?.aborted).toBe(false);

    store.releaseDataOwner(owner);
    expect(signals[0]?.aborted).toBe(true);
    expect(store.inspectDataEntries()).toEqual([]);
  });

  it("keeps a refreshing entry's value when its last subscriber is released", () => {
    let loads = 0;
    const owner = {};
    const valueResource = dataResource({
      key: (id: string) => ["refreshing-release", id],
      load: () => {
        loads += 1;
        return loads === 1 ? "first" : never;
      },
    });
    const store = createDataStore<object, null>({
      context: {},
      getLane: () => null,
      schedule: () => undefined,
    });

    expect(store.readData(valueResource, ["one"], owner)).toBe("first");
    store.commitDataDependencies(owner, null);

    // Start a background refresh, leaving the entry value-bearing and in flight.
    store.invalidateData(valueResource, "one");
    expect(store.readData(valueResource, ["one"], owner)).toBe("first");
    expect(loads).toBe(2);

    // Releasing the last subscriber must not evict a value-bearing entry: only
    // value-less cache-miss loads are dropped.
    store.releaseDataOwner(owner);
    const entries = store.inspectDataEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.hasValue).toBe(true);
    expect(entries[0]?.value).toBe("first");
  });

  it("ignores store mutations after dispose", async () => {
    let loads = 0;
    const valueResource = dataResource({
      key: (id: string) => ["post-dispose", id],
      load: () => {
        loads += 1;
        return "value";
      },
    });
    const store = createDataStore<object, null>({
      context: {},
      getLane: () => null,
      schedule: () => undefined,
    });

    store.dispose();
    store.run(() => preloadData(valueResource, "one"));
    store.run(() => invalidateData(valueResource, "one"));

    await expect(
      store.run(() => refreshData(valueResource, "one")),
    ).resolves.toEqual({
      reason: "store-disposed",
      staleValue: undefined,
      status: "aborted",
    });

    expect(loads).toBe(0);
    expect(store.inspectDataEntries()).toEqual([]);
  });

  it("reports retention eviction as 'evicted', not 'store-disposed'", async () => {
    const pendingResource = dataResource({
      key: (id: string) => ["evicted-reason", id],
      load: () => never,
    });
    const store = createDataStore<object, null>({
      context: {},
      getLane: () => null,
      inactiveRetentionMs: Number.POSITIVE_INFINITY,
      preloadRetentionMs: 0,
      schedule: () => undefined,
    });

    // A refresh coalesces onto the in-flight preload; when the preload retention
    // window elapses on a live store, the awaiter learns it was evicted.
    store.run(() => preloadData(pendingResource, "one"));
    const result = store.run(() => refreshData(pendingResource, "one"));
    await delay();

    await expect(result).resolves.toEqual({
      reason: "evicted",
      staleValue: undefined,
      status: "aborted",
    });
  });
});

function delay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
