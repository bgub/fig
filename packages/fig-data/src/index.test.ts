import { describe, expect, it } from "vite-plus/test";
import {
  createDataStore,
  dataResource,
  invalidateData,
  preloadData,
  refreshData,
} from "./index.ts";

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

    await expect(store.refreshData(messageResource, ["one"])).resolves.toEqual({
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
    store.commitDataDependencies(owner, null, null);
    store.deleteDataOwner(owner);
    await delay();

    expect(evicted).toEqual(['["label","one"]']);
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

    const result = store.refreshData(pendingResource, ["one"]);
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

    await store.refreshData(valueResource, ["one"]);
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
    store.commitDataDependencies(owner, null, null);

    const first = store.refreshData(valueResource, ["one"]);
    const second = store.refreshData(valueResource, ["one"]);

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
