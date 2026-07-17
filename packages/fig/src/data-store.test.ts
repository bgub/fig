import { describe, expect, it, vi } from "vitest";
import {
  dataResource,
  ensureData,
  invalidateData,
  invalidateDataError,
  invalidateDataKey,
  invalidateDataPrefix,
  preloadData,
  refreshData,
} from "./index.ts";
import {
  createDataStore,
  dataResourceKeysForError,
  type LoadContextAttributeError,
  type LoadContextHydrate,
  loadContextCapabilities,
  normalizeDataResourceKey,
} from "./internal.ts";

const never = new Promise<never>(() => undefined);

describe("@bgub/fig", () => {
  it("encodes data keys structurally without delimiter collisions", () => {
    const keys = [
      ["key", "a,b"],
      ["key", "a", "b"],
      ["key", "a:b"],
      ["key", { a: "b" }],
      ["key", '["x"]'],
      ["key", ["x"]],
      ["key", '{"x":1}'],
      ["key", { x: 1 }],
      ["key", "a|b"],
    ] as const;

    const encoded = keys.map(normalizeDataResourceKey);
    expect(new Set(encoded).size).toBe(keys.length);
    expect(encoded).toEqual([
      '["key","a,b"]',
      '["key","a","b"]',
      '["key","a:b"]',
      '["key",{"a":"b"}]',
      '["key","[\\"x\\"]"]',
      '["key",["x"]]',
      '["key","{\\"x\\":1}"]',
      '["key",{"x":1}]',
      '["key","a|b"]',
    ]);
  });

  it("canonicalizes data key objects and negative zero", () => {
    expect(normalizeDataResourceKey(["key", { b: 1, a: -0 }])).toBe(
      '["key",{"a":0,"b":1}]',
    );
    expect(normalizeDataResourceKey(["key", { a: -0, b: 1 }])).toBe(
      '["key",{"a":0,"b":1}]',
    );
  });

  it("passes loader arguments and abort signals to loaders", async () => {
    const signals: AbortSignal[] = [];
    const messageResource = dataResource({
      key: (id: string) => ["message", id],
      load: (id: string, { signal }) => {
        signals.push(signal);
        return `hello-${id}`;
      },
    });
    const store = createDataStore<object, null>({
      getLane: () => null,
      schedule: () => undefined,
    });

    await expect(store.refreshData(messageResource, "one")).resolves.toEqual({
      status: "fulfilled",
      value: "hello-one",
    });
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);
  });

  it("does not require a process global for data reads", () => {
    vi.stubGlobal("process", undefined);

    try {
      const owner = {};
      const resource = dataResource({
        key: (id: string) => ["processless", id],
        load: (id: string) => `value-${id}`,
      });
      const store = createDataStore<object, null>({
        getLane: () => null,
        schedule: () => undefined,
      });

      expect(store.readData(resource, ["one"], owner)).toBe("value-one");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("evicts inactive fulfilled entries after their retention window", async () => {
    const evicted: string[] = [];
    const owner = {};
    const labelResource = dataResource({
      key: (id: string) => ["label", id],
      load: () => "ready",
    });
    const store = createDataStore<object, null>({
      getLane: () => null,
      inactiveRetentionMs: 0,
      onEntryEvict: (entry) => evicted.push(entry.canonicalKey),
      schedule: () => undefined,
    });

    expect(store.readData(labelResource, ["one"], owner)).toBe("ready");
    store.commitDataDependencies(owner, null);
    store.deleteDataOwner(owner);
    await waitForNextMacrotask();

    expect(evicted).toEqual(['["label","one"]']);
  });

  it("drops dependencies from abandoned render attempts on reset", () => {
    const scheduled: object[] = [];
    const owner = {};
    const resource = dataResource<[string], string>({
      key: (id: string) => ["reset", id],
      load: (id: string) => id,
    });
    const store = createDataStore<object, null>({
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
    expect(store.inspectDataDependencyCanonicalKeys(owner)).toEqual([
      '["reset","b"]',
    ]);

    // The owner no longer reads "a", so invalidating it must not schedule it.
    store.invalidateData(resource, "a");
    expect(scheduled).toEqual([]);

    store.invalidateData(resource, "b");
    expect(scheduled).toEqual([owner]);
  });

  it("does not arm inactive cleanup timers for retained dependencies", () => {
    const timers: Array<() => void> = [];
    let clearedTimers = 0;
    vi.stubGlobal("setTimeout", ((callback: () => void) => {
      timers.push(callback);
      return { unref: () => undefined };
    }) as unknown as typeof setTimeout);
    vi.stubGlobal("clearTimeout", (() => {
      clearedTimers += 1;
    }) as unknown as typeof clearTimeout);

    try {
      const previousOwner = {};
      const owner = {};
      const resource = dataResource({
        key: (id: string) => ["retained", id],
        load: (id: string) => id,
      });
      const store = createDataStore<object, null>({
        getLane: () => null,
        schedule: () => undefined,
      });

      expect(store.readData(resource, ["one"], previousOwner)).toBe("one");
      store.commitDataDependencies(previousOwner, null);
      const timerCount = timers.length;
      const clearedTimerCount = clearedTimers;

      expect(store.readData(resource, ["one"], owner)).toBe("one");
      store.commitDataDependencies(owner, previousOwner);

      expect(timers).toHaveLength(timerCount);
      expect(clearedTimers).toBe(clearedTimerCount);

      store.releaseDataOwner(owner);
      expect(timers).toHaveLength(timerCount + 1);
    } finally {
      vi.unstubAllGlobals();
    }
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
      getLane: () => null,
      inactiveRetentionMs: Number.POSITIVE_INFINITY,
      onEntryEvict: (entry) => evicted.push(entry.canonicalKey),
      preloadRetentionMs: 0,
      schedule: () => undefined,
    });

    store.run(() => preloadData(pendingResource, "one"));
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);

    await waitForNextMacrotask();

    expect(signals[0]?.aborted).toBe(true);
    expect(evicted).toEqual(['["pending","one"]']);
  });

  it("settles pending refresh callers when the store is disposed", async () => {
    const pendingResource = dataResource({
      key: (id: string) => ["dispose", id],
      load: () => never,
    });
    const store = createDataStore<object, null>({
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
      getLane: () => null,
      schedule: () => undefined,
    });

    await store.refreshData(valueResource, "one");
    store.run(() => invalidateData(valueResource, "one"));
    await waitForNextMacrotask();

    expect(loads).toBe(1);
  });

  it("invalidates observed keys by prefix", () => {
    const userOwner = {};
    const postOwner = {};
    const scheduled: object[] = [];
    const userResource = dataResource<[string], string>({
      key: (id: string) => ["entity", "user", id],
      load: (id: string) => `user-${id}`,
    });
    const postResource = dataResource<[string], string>({
      key: (id: string) => ["entity", "post", id],
      load: (id: string) => `post-${id}`,
    });
    const store = createDataStore<object, string>({
      getLane: () => "mutation",
      schedule: (subscriber) => scheduled.push(subscriber),
    });

    expect(store.readData(userResource, ["one"], userOwner)).toBe("user-one");
    expect(store.readData(postResource, ["one"], postOwner)).toBe("post-one");
    store.commitDataDependencies(userOwner, null);
    store.commitDataDependencies(postOwner, null);

    store.run(() => invalidateDataPrefix(["entity", "user"]));

    expect(scheduled).toEqual([userOwner]);
    const byKey = new Map(
      store.inspectDataEntries().map((entry) => [entry.canonicalKey, entry]),
    );
    expect(byKey.get('["entity","user","one"]')?.stale).toBe(true);
    expect(byKey.get('["entity","post","one"]')?.stale).toBe(false);
  });

  it("matches invalidation prefixes structurally", () => {
    const exactOwner = {};
    const delimiterOwner = {};
    const namespaceOwner = {};
    const scheduled: object[] = [];
    const resource = dataResource<[string], string>({
      key: (key: string) => ["prefix", key],
      load: (key: string) => key,
    });
    const nestedResource = dataResource<
      [{ label: string; scope: string[] }],
      string
    >({
      key: (input: { label: string; scope: string[] }) => [
        "prefix",
        { label: input.label, scope: input.scope },
      ],
      load: () => "nested",
    });
    const store = createDataStore<object, null>({
      getLane: () => null,
      schedule: (subscriber) => scheduled.push(subscriber),
    });

    expect(store.readData(resource, ["user"], exactOwner)).toBe("user");
    expect(store.readData(resource, ["user|settings"], delimiterOwner)).toBe(
      "user|settings",
    );
    expect(
      store.readData(
        nestedResource,
        [{ label: "profile", scope: ["public"] }],
        namespaceOwner,
      ),
    ).toBe("nested");
    store.commitDataDependencies(exactOwner, null);
    store.commitDataDependencies(delimiterOwner, null);
    store.commitDataDependencies(namespaceOwner, null);

    store.invalidateDataPrefix(["prefix", "user"]);
    expect(scheduled).toEqual([exactOwner]);

    scheduled.length = 0;
    store.invalidateDataPrefix([
      "prefix",
      { scope: ["public"], label: "profile" },
    ]);
    expect(scheduled).toEqual([namespaceOwner]);
  });

  it("invalidates an exact structural key", () => {
    const owner = {};
    const scheduled: object[] = [];
    const resource = dataResource<[{ a: number; b: number }], string>({
      key: (input) => ["exact-key", input],
      load: () => "value",
    });
    const store = createDataStore<object, string>({
      getLane: () => "retry",
      schedule: (subscriber) => scheduled.push(subscriber),
    });

    expect(store.readData(resource, [{ a: 1, b: 2 }], owner)).toBe("value");
    store.commitDataDependencies(owner, null);

    store.run(() => invalidateDataKey(["exact-key", { b: 2, a: 1 }]));

    expect(scheduled).toEqual([owner]);
    expect(
      store
        .inspectDataEntries()
        .find((entry) => entry.canonicalKey === '["exact-key",{"a":1,"b":2}]')
        ?.stale,
    ).toBe(true);
  });

  it("schedules hydrated subscribers on the current lane", async () => {
    const owner = {};
    const scheduled: Array<[object, string]> = [];
    let lane = "initial";
    const resource = dataResource<[string], string>({
      key: (id) => ["hydrate-lane", id],
      load: (id) => `loaded-${id}`,
    });
    const store = createDataStore<object, string>({
      getLane: () => lane,
      schedule: (subscriber, scheduledLane) =>
        scheduled.push([subscriber, scheduledLane]),
    });

    expect(store.readData(resource, ["one"], owner)).toBe("loaded-one");
    store.commitDataDependencies(owner, null);

    lane = "refresh";
    await store.refreshData(resource, "one");
    scheduled.length = 0;

    lane = "hydrate";
    store.hydrate([{ key: ["hydrate-lane", "one"], value: "hydrated" }]);

    expect(scheduled).toEqual([[owner, "hydrate"]]);
  });

  it("does not create entries for unsupported refreshes with no value", async () => {
    const changes: string[] = [];
    const hydrateOnlyResource = dataResource<[string], string>({
      key: (id) => ["hydrate-only-missing", id],
    });
    const store = createDataStore<object, null>({
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
    await waitForNextMacrotask();
    expect(loads).toBe(2);

    expect(store.readData(valueResource, ["one"], owner)).toBe("value");
    expect(store.readData(valueResource, ["one"], owner)).toBe("value");
    expect(loads).toBe(2);

    // An explicit invalidation is a fresh intent and re-enables auto-refresh.
    failNext = false;
    store.invalidateData(valueResource, "one");
    expect(store.readData(valueResource, ["one"], owner)).toBe("value");
    await waitForNextMacrotask();
    expect(loads).toBe(3);
  });

  it("reloads when invalidated while an initial load is in flight", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const loads = [first, second];
    const owner = {};
    const scheduled: object[] = [];
    const valueResource = dataResource({
      key: (id: string) => ["invalidate-pending", id],
      load: () => {
        const next = loads.shift();
        if (next === undefined) throw new Error("Unexpected load.");
        return next.promise;
      },
    });
    const store = createDataStore<object, null>({
      getLane: () => null,
      schedule: (subscriber) => scheduled.push(subscriber),
    });

    expect(() => store.readData(valueResource, ["one"], owner)).toThrow();
    store.commitDataDependencies(owner, null);

    store.invalidateData(valueResource, "one");
    expect(scheduled).toEqual([owner]);

    first.resolve("stale");
    await waitForNextMacrotask();

    expect(store.readData(valueResource, ["one"], owner)).toBe("stale");
    expect(store.inspectDataEntries()).toMatchObject([
      {
        stale: true,
        status: "refreshing",
        value: "stale",
      },
    ]);

    second.resolve("fresh");
    await waitForNextMacrotask();

    expect(store.readData(valueResource, ["one"], owner)).toBe("fresh");
    expect(store.inspectDataEntries()).toMatchObject([
      {
        stale: false,
        status: "fulfilled",
        value: "fresh",
      },
    ]);
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

  it("keeps value-bearing preload refreshes through the preload grace window", async () => {
    let loads = 0;
    const valueResource = dataResource({
      key: (id: string) => ["refreshing-preload", id],
      load: () => {
        loads += 1;
        return loads === 1 ? "first" : never;
      },
    });
    const store = createDataStore<object, null>({
      getLane: () => null,
      inactiveRetentionMs: Number.POSITIVE_INFINITY,
      preloadRetentionMs: 0,
      schedule: () => undefined,
    });

    store.run(() => preloadData(valueResource, "one"));
    store.run(() => invalidateData(valueResource, "one"));
    store.run(() => preloadData(valueResource, "one"));
    await waitForNextMacrotask();

    const entries = store.inspectDataEntries();
    expect(loads).toBe(2);
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
      getLane: () => null,
      schedule: () => undefined,
    });

    store.dispose();
    store.hydrate([{ key: ["post-dispose", "hydrated"], value: "hydrated" }]);
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
      getLane: () => null,
      inactiveRetentionMs: Number.POSITIVE_INFINITY,
      preloadRetentionMs: 0,
      schedule: () => undefined,
    });

    // A refresh coalesces onto the in-flight preload; when the preload retention
    // window elapses on a live store, the awaiter learns it was evicted.
    store.run(() => preloadData(pendingResource, "one"));
    const result = store.run(() => refreshData(pendingResource, "one"));
    await waitForNextMacrotask();

    await expect(result).resolves.toEqual({
      reason: "evicted",
      staleValue: undefined,
      status: "aborted",
    });
  });

  it("rethrows a cached rejection until invalidation resets it to pending", async () => {
    let attempts = 0;
    const owner = {};
    const scheduled: object[] = [];
    const flakyResource = dataResource({
      key: (id: string) => ["flaky", id],
      load: () => {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new Error("load failed"))
          : Promise.resolve("recovered");
      },
    });
    const store = createDataStore<object, null>({
      getLane: () => null,
      schedule: (subscriber) => scheduled.push(subscriber),
    });

    // First read suspends on the initial load, which rejects.
    expect(() => store.readData(flakyResource, ["one"], owner)).toThrow();
    store.commitDataDependencies(owner, null);
    await waitForNextMacrotask();

    // The rejection is cached: every read rethrows without a new load.
    expect(() => store.readData(flakyResource, ["one"], owner)).toThrow(
      "load failed",
    );
    expect(() => store.readData(flakyResource, ["one"], owner)).toThrow(
      "load failed",
    );
    expect(attempts).toBe(1);

    // Invalidation means "fetch again" for failures too: the entry returns to
    // pending, subscribers are scheduled, and the next read loads afresh.
    scheduled.length = 0;
    store.invalidateData(flakyResource, "one");
    expect(scheduled).toEqual([owner]);
    expect(
      store
        .inspectDataEntries()
        .find((entry) => entry.canonicalKey === '["flaky","one"]')?.status,
    ).toBe("pending");

    expect(() => store.readData(flakyResource, ["one"], owner)).toThrow();
    await waitForNextMacrotask();

    expect(store.readData(flakyResource, ["one"], owner)).toBe("recovered");
    expect(attempts).toBe(2);
  });

  it("invalidates every key attributed to a data error", async () => {
    const firstOwner = {};
    const secondOwner = {};
    const scheduled: object[] = [];
    const sharedError = new Error("shared failure");
    const attempts = new Map<string, number>();
    const flakyResource = dataResource<[string], string>({
      key: (id) => ["flaky-error", id],
      load: (id) => {
        const nextAttempts = (attempts.get(id) ?? 0) + 1;
        attempts.set(id, nextAttempts);
        return nextAttempts === 1
          ? Promise.reject(sharedError)
          : Promise.resolve(`recovered-${id}`);
      },
    });
    const store = createDataStore<object, null>({
      getLane: () => null,
      schedule: (subscriber) => scheduled.push(subscriber),
    });

    expect(() => store.readData(flakyResource, ["one"], firstOwner)).toThrow();
    store.commitDataDependencies(firstOwner, null);
    expect(() => store.readData(flakyResource, ["two"], secondOwner)).toThrow();
    store.commitDataDependencies(secondOwner, null);
    await waitForNextMacrotask();

    expect(() => store.readData(flakyResource, ["one"], firstOwner)).toThrow(
      sharedError,
    );
    expect(() => store.readData(flakyResource, ["two"], secondOwner)).toThrow(
      sharedError,
    );

    scheduled.length = 0;
    expect(store.run(() => invalidateDataError(sharedError))).toBe(true);
    expect(scheduled).toEqual([firstOwner, secondOwner]);

    const byKey = new Map(
      store.inspectDataEntries().map((entry) => [entry.canonicalKey, entry]),
    );
    expect(byKey.get('["flaky-error","one"]')?.status).toBe("pending");
    expect(byKey.get('["flaky-error","two"]')?.status).toBe("pending");

    expect(() => store.readData(flakyResource, ["one"], firstOwner)).toThrow();
    expect(() => store.readData(flakyResource, ["two"], secondOwner)).toThrow();
    await waitForNextMacrotask();

    expect(store.readData(flakyResource, ["one"], firstOwner)).toBe(
      "recovered-one",
    );
    expect(store.readData(flakyResource, ["two"], secondOwner)).toBe(
      "recovered-two",
    );
  });

  it("does not invalidate untagged errors", () => {
    const store = createDataStore<object, null>({
      getLane: () => null,
      schedule: () => undefined,
    });

    expect(store.invalidateDataError(new Error("plain"))).toBe(false);
    expect(store.run(() => invalidateDataError("plain"))).toBe(false);
  });

  it("recovers a rejected entry through refreshData", async () => {
    let attempts = 0;
    const flakyResource = dataResource({
      key: (id: string) => ["flaky-refresh", id],
      load: () => {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new Error("load failed"))
          : Promise.resolve("recovered");
      },
    });
    const store = createDataStore<object, null>({
      getLane: () => null,
      schedule: () => undefined,
    });

    await expect(store.refreshData(flakyResource, "one")).resolves.toEqual({
      error: new Error("load failed"),
      status: "rejected",
    });

    await expect(store.refreshData(flakyResource, "one")).resolves.toEqual({
      status: "fulfilled",
      value: "recovered",
    });
  });
});

describe("generation-lifetime loader signals", () => {
  function signalStore() {
    return createDataStore<object, null>({
      getLane: () => null,
      schedule: () => undefined,
    });
  }

  it("keeps the signal live until a successor becomes authoritative", async () => {
    const signals: AbortSignal[] = [];
    const gate = deferred<string>();
    let loads = 0;
    const resource = dataResource<[string], string>({
      key: (id: string) => ["gen", id],
      load: (_id, { signal }) => {
        signals.push(signal);
        loads += 1;
        return loads === 1 ? "initial" : gate.promise;
      },
    });
    const store = signalStore();

    await store.refreshData(resource, "one");
    // The generation is authoritative: background work tied to the signal
    // (a payload decode filling holes) keeps running after the value lands.
    expect(signals[0]?.aborted).toBe(false);

    // A superseding refresh STARTING does not revoke authority — the stale
    // value stays fully alive (holes included) through the refresh window.
    const refresh = store.refreshData(resource, "one");
    expect(signals[0]?.aborted).toBe(false);

    // Authority transfers when the successor's value publishes.
    gate.resolve("refreshed");
    await refresh;
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });

  it("aborts the fulfilled generation's signal on hydrate-over", async () => {
    const signals: AbortSignal[] = [];
    const resource = dataResource({
      key: (id: string) => ["gen-hydrate", id],
      load: (_id: string, { signal }) => {
        signals.push(signal);
        return "loaded";
      },
    });
    const store = signalStore();

    await store.refreshData(resource, "one");
    store.hydrate([{ key: ["gen-hydrate", "one"], value: "pushed" }]);

    expect(signals[0]?.aborted).toBe(true);
  });

  it("aborts the fulfilled generation's signal on store disposal", async () => {
    const signals: AbortSignal[] = [];
    const resource = dataResource({
      key: (id: string) => ["gen-dispose", id],
      load: (_id: string, { signal }) => {
        signals.push(signal);
        return "loaded";
      },
    });
    const store = signalStore();

    await store.refreshData(resource, "one");
    store.dispose();

    expect(signals[0]?.aborted).toBe(true);
  });

  it("aborts the fulfilled generation's signal when the entry evicts", async () => {
    const signals: AbortSignal[] = [];
    const owner = {};
    const resource = dataResource({
      key: (id: string) => ["gen-evict", id],
      load: (_id: string, { signal }) => {
        signals.push(signal);
        return "loaded";
      },
    });
    const store = createDataStore<object, null>({
      getLane: () => null,
      inactiveRetentionMs: 0,
      schedule: () => undefined,
    });

    expect(store.readData(resource, ["one"], owner)).toBe("loaded");
    store.commitDataDependencies(owner, null);
    store.deleteDataOwner(owner);
    await waitForNextMacrotask();

    expect(signals[0]?.aborted).toBe(true);
  });

  it("keeps the signal live across invalidateData", async () => {
    const signals: AbortSignal[] = [];
    const resource = dataResource({
      key: (id: string) => ["gen-invalidate", id],
      load: (_id: string, { signal }) => {
        signals.push(signal);
        return "loaded";
      },
    });
    const store = signalStore();

    await store.refreshData(resource, "one");
    store.invalidateData(resource, "one");

    // Marking stale does not revoke authority; only a newer load does.
    expect(signals[0]?.aborted).toBe(false);
  });

  it("aborts a rejected load's own signal", async () => {
    const signals: AbortSignal[] = [];
    const resource = dataResource<[string], string>({
      key: (id: string) => ["gen-reject", id],
      load: (_id: string, { signal }) => {
        signals.push(signal);
        return signals.length === 1
          ? Promise.reject(new Error("load failed"))
          : "recovered";
      },
    });
    const store = signalStore();

    const first = await store.refreshData(resource, "one");
    expect(first.status).toBe("rejected");
    expect(signals[0]?.aborted).toBe(true);

    const second = await store.refreshData(resource, "one");
    expect(second.status).toBe("fulfilled");
    expect(signals[1]?.aborted).toBe(false);
  });

  it("keeps the stale generation alive when a refresh fails", async () => {
    const signals: AbortSignal[] = [];
    const resource = dataResource<[string], string>({
      key: (id: string) => ["gen-refresh-fail", id],
      load: (_id: string, { signal }) => {
        signals.push(signal);
        return signals.length === 1
          ? "initial"
          : Promise.reject(new Error("refresh failed"));
      },
    });
    const store = signalStore();

    await store.refreshData(resource, "one");
    const refresh = await store.refreshData(resource, "one");

    expect(refresh).toMatchObject({
      status: "rejected",
      staleValue: "initial",
    });
    // The failed generation aborts its own work; the previous generation
    // remains authoritative — its stale value and live holes stay usable.
    expect(signals[0]?.aborted).toBe(false);
    expect(signals[1]?.aborted).toBe(true);
  });

  it("aborts a pending cache-miss load when superseded at start", async () => {
    const signals: AbortSignal[] = [];
    const never = deferred<string>();
    let loads = 0;
    const resource = dataResource<[string], string>({
      key: (id: string) => ["gen-pending", id],
      load: (_id, { signal }) => {
        signals.push(signal);
        loads += 1;
        return loads === 1 ? never.promise : "second";
      },
    });
    const store = createDataStore<object, null>({
      getLane: () => null,
      schedule: () => undefined,
    });

    void store.refreshData(resource, "one");
    store.hydrate([{ key: ["gen-pending", "one"], value: "pushed" }]);

    // A value-less pending load has no authority to defer: it dies at once.
    expect(signals[0]?.aborted).toBe(true);
  });
});

describe("load-context error attribution capability", () => {
  it("attributes live-generation errors and ignores retired generations", async () => {
    const captured: Array<LoadContextAttributeError | undefined> = [];
    const resource = dataResource<[], string>({
      key: () => ["payload-entry"],
      load: (context) => {
        captured.push(loadContextCapabilities(context)?.attributeError);
        return `value-${captured.length}`;
      },
    });
    const store = createDataStore<object, null>({
      getLane: () => null,
      schedule: () => undefined,
    });

    await store.refreshData(resource);
    const liveError = new Error("live hole");
    captured[0]?.(liveError);
    expect(dataResourceKeysForError(liveError)).toEqual([["payload-entry"]]);

    await store.refreshData(resource);
    const retiredError = new Error("retired hole");
    captured[0]?.(retiredError);
    expect(dataResourceKeysForError(retiredError)).toBeUndefined();

    const successorError = new Error("successor hole");
    captured[1]?.(successorError);
    expect(dataResourceKeysForError(successorError)).toEqual([
      ["payload-entry"],
    ]);
  });

  it("retires a value whose hole error was attributed before publish", async () => {
    // A hole's error row can share a network chunk with the root row (a
    // server component that throws synchronously), so attribution fires
    // before the loader's returned promise settles. It must survive publish.
    const holeError = new Error("sync hole");
    const gate = deferred<string>();
    let loads = 0;
    const resource = dataResource<[], string>({
      key: () => ["pre-publish-hole"],
      load: (context) => {
        loads += 1;
        if (loads === 1) {
          loadContextCapabilities(context)?.attributeError(holeError);
          return "broken";
        }
        return gate.promise;
      },
    });
    const store = createDataStore<object, null>({
      getLane: () => null,
      schedule: () => undefined,
    });

    await store.refreshData(resource);
    expect(dataResourceKeysForError(holeError)).toEqual([["pre-publish-hole"]]);
    expect(store.invalidateDataError(holeError)).toBe(true);

    // Retired, not served stale: the next read suspends on a fresh load
    // instead of returning the broken value.
    let thrown: unknown;
    try {
      store.readData(resource, [], {});
    } catch (error) {
      thrown = error;
    }
    expect(loads).toBe(2);
    expect(thrown).toBeInstanceOf(Promise);
    gate.resolve("fresh");
    await waitForNextMacrotask();
    expect(store.readData(resource, [], {})).toBe("fresh");
  });

  it("attributes through a superseding refresh's window", async () => {
    const captured: Array<LoadContextAttributeError | undefined> = [];
    const gate = deferred<string>();
    let loads = 0;
    const resource = dataResource<[], string>({
      key: () => ["refresh-window-hole"],
      load: (context) => {
        captured.push(loadContextCapabilities(context)?.attributeError);
        loads += 1;
        return loads === 1 ? "v1" : gate.promise;
      },
    });
    const store = createDataStore<object, null>({
      getLane: () => null,
      schedule: () => undefined,
    });

    await store.refreshData(resource);
    const refresh = store.refreshData(resource);

    // The visible value keeps its authority — and keeps attributing — until
    // the successor publishes.
    const holeError = new Error("window hole");
    captured[0]?.(holeError);
    expect(dataResourceKeysForError(holeError)).toEqual([
      ["refresh-window-hole"],
    ]);
    expect(store.invalidateDataError(holeError)).toBe(true);

    // The broken value is retired; the in-flight refresh delivers recovery.
    let thrown: unknown;
    try {
      store.readData(resource, [], {});
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Promise);
    gate.resolve("v2");
    await refresh;
    expect(store.readData(resource, [], {})).toBe("v2");
  });

  it("rejects cleanly when the refresh fails after the broken value was retired", async () => {
    const captured: Array<LoadContextAttributeError | undefined> = [];
    let failRefresh: (error: unknown) => void = () => undefined;
    let loads = 0;
    const resource = dataResource<[], string>({
      key: () => ["retire-then-reject"],
      load: (context) => {
        captured.push(loadContextCapabilities(context)?.attributeError);
        loads += 1;
        if (loads === 1) return "v1";
        return new Promise<string>((_resolve, reject) => {
          failRefresh = reject;
        });
      },
    });
    const store = createDataStore<object, null>({
      getLane: () => null,
      schedule: () => undefined,
    });

    await store.refreshData(resource);
    const refresh = store.refreshData(resource);

    const holeError = new Error("window hole");
    captured[0]?.(holeError);
    expect(store.invalidateDataError(holeError)).toBe(true);

    // The in-flight refresh fails, but the value it was refreshing is
    // already retired: the entry must reject with the refresh error, not
    // resurrect the retired value as a fulfilled `undefined`.
    const refreshError = new Error("refresh failed");
    failRefresh(refreshError);
    const result = await refresh;
    expect(result).toEqual({ error: refreshError, status: "rejected" });

    let thrown: unknown;
    try {
      store.readData(resource, [], {});
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(refreshError);
    expect(loads).toBe(2);
  });

  it("keeps the previous value when a failed refresh attributed a hole error", async () => {
    const refreshHole = new Error("refresh hole");
    const stuck = deferred<string>();
    let loads = 0;
    const resource = dataResource<[], string>({
      key: () => ["failed-refresh-hole"],
      load: (context) => {
        loads += 1;
        if (loads === 2) {
          loadContextCapabilities(context)?.attributeError(refreshHole);
          return Promise.reject(new Error("refresh failed"));
        }
        return loads === 1 ? "v1" : stuck.promise;
      },
    });
    const store = createDataStore<object, null>({
      getLane: () => null,
      schedule: () => undefined,
    });

    await store.refreshData(resource);
    const refresh = await store.refreshData(resource);
    expect(refresh.status).toBe("rejected");

    // The failed generation never published; invalidating its hole error
    // marks the entry stale but must not retire the live previous value.
    expect(store.invalidateDataError(refreshHole)).toBe(true);
    expect(store.readData(resource, [], {})).toBe("v1");
    expect(loads).toBe(3);
  });

  it("hydrating over an entry clears its attributed hole errors", async () => {
    const captured: Array<LoadContextAttributeError | undefined> = [];
    const stuck = deferred<string>();
    let loads = 0;
    const resource = dataResource<[], string>({
      key: () => ["hydrate-over-hole"],
      load: (context) => {
        captured.push(loadContextCapabilities(context)?.attributeError);
        loads += 1;
        return loads === 1 ? "v1" : stuck.promise;
      },
    });
    const store = createDataStore<object, null>({
      getLane: () => null,
      schedule: () => undefined,
    });

    await store.refreshData(resource);
    const holeError = new Error("stale hole");
    captured[0]?.(holeError);
    store.hydrate([{ key: ["hydrate-over-hole"], value: "pushed" }]);

    // The error still names the key, but the hydrated value is not the
    // broken one: invalidating marks it stale without retiring it.
    expect(store.invalidateDataError(holeError)).toBe(true);
    expect(store.readData(resource, [], {})).toBe("pushed");
  });
});

describe("load-context hydrate capability", () => {
  function capturingResource(key: string) {
    const captured: Array<LoadContextHydrate | undefined> = [];
    const resource = dataResource<[string], string>({
      key: (id: string) => [key, id],
      load: (_id, context) => {
        captured.push(loadContextCapabilities(context)?.hydrate);
        return `value-${captured.length}`;
      },
    });
    return { captured, resource };
  }

  function capabilityStore() {
    return createDataStore<object, null>({
      getLane: () => null,
      schedule: () => undefined,
    });
  }

  it("hydrates foreign keys through the calling store while authoritative", async () => {
    const { captured, resource } = capturingResource("cap");
    const store = capabilityStore();

    await store.refreshData(resource, "one");
    const hydrate = captured[0];
    expect(hydrate).toBeTypeOf("function");

    hydrate?.([{ key: ["cap-user", "1"], value: { name: "Ada" } }]);
    expect(store.snapshot()).toEqual(
      expect.arrayContaining([
        { key: ["cap-user", "1"], value: { name: "Ada" } },
      ]),
    );
  });

  it("keeps hydrating through a superseding refresh's window", async () => {
    const captured: Array<LoadContextHydrate | undefined> = [];
    const stuck = deferred<string>();
    let loads = 0;
    const resource = dataResource<[], string>({
      key: () => ["cap-window"],
      load: (context) => {
        captured.push(loadContextCapabilities(context)?.hydrate);
        loads += 1;
        return loads === 1 ? "v1" : stuck.promise;
      },
    });
    const store = capabilityStore();

    await store.refreshData(resource);
    void store.refreshData(resource);

    // The visible generation keeps its authority — and its data rows keep
    // hydrating — until the successor publishes, not when it merely starts.
    captured[0]?.([{ key: ["cap-window-user", "1"], value: "streamed" }]);
    expect(store.snapshot()).toEqual(
      expect.arrayContaining([
        { key: ["cap-window-user", "1"], value: "streamed" },
      ]),
    );
  });

  it("ignores hydration after supersession and disposal", async () => {
    const { captured, resource } = capturingResource("cap-guard");
    const store = capabilityStore();

    await store.refreshData(resource, "one");
    await store.refreshData(resource, "one");
    const superseded = captured[0];

    superseded?.([{ key: ["cap-guard-late", "1"], value: "late" }]);
    expect(store.snapshot()).not.toEqual(
      expect.arrayContaining([{ key: ["cap-guard-late", "1"], value: "late" }]),
    );

    const live = captured[1];
    store.dispose();
    live?.([{ key: ["cap-guard-late", "2"], value: "late" }]);
  });

  it("skips data rows targeting the loading entry's own key", async () => {
    const { captured, resource } = capturingResource("cap-self");
    const store = capabilityStore();
    const signals: AbortSignal[] = [];
    const selfAware = dataResource<[string], string>({
      key: (id: string) => ["cap-self", id],
      load: (_id, context) => {
        signals.push(context.signal);
        captured.push(loadContextCapabilities(context)?.hydrate);
        return "loader-value";
      },
    });
    void resource;

    await store.refreshData(selfAware, "one");
    const hydrate = captured[0];

    hydrate?.([
      { key: ["cap-self", "one"], value: "row-value" },
      { key: ["cap-self-other", "1"], value: "other" },
    ]);
    // The loader's own generation was not superseded by its own data row.
    expect(signals[0]?.aborted).toBe(false);
    const snapshot = store.snapshot();
    expect(snapshot).toEqual(
      expect.arrayContaining([
        { key: ["cap-self", "one"], value: "loader-value" },
        { key: ["cap-self-other", "1"], value: "other" },
      ]),
    );
  });

  it("hydrates mid-load, before the loader settles", async () => {
    const gate = deferred<string>();
    let hydrate: LoadContextHydrate | undefined;
    const resource = dataResource<[string], string>({
      key: (id: string) => ["cap-midload", id],
      load: (_id, context) => {
        hydrate = loadContextCapabilities(context)?.hydrate;
        return gate.promise;
      },
    });
    const store = capabilityStore();

    const pending = store.refreshData(resource, "one");
    hydrate?.([{ key: ["cap-midload-user", "1"], value: "early" }]);
    expect(store.snapshot()).toEqual(
      expect.arrayContaining([
        { key: ["cap-midload-user", "1"], value: "early" },
      ]),
    );

    gate.resolve("done");
    await expect(pending).resolves.toEqual({
      status: "fulfilled",
      value: "done",
    });
  });
});

describe("ensureData", () => {
  function ensureStore() {
    return createDataStore<object, null>({
      getLane: () => null,
      schedule: () => undefined,
    });
  }

  it("loads on a cache miss and reuses the cached value", async () => {
    let loads = 0;
    const resource = dataResource<[string], string>({
      key: (id: string) => ["ensure", id],
      load: async (id: string) => {
        loads += 1;
        return `value-${id}`;
      },
    });
    const store = ensureStore();

    await expect(store.ensureData(resource, "one")).resolves.toBe("value-one");
    await expect(store.ensureData(resource, "one")).resolves.toBe("value-one");
    expect(loads).toBe(1);
  });

  it("resolves the ambient store for the free function", async () => {
    const resource = dataResource<[string], string>({
      key: (id: string) => ["ensure-ambient", id],
      load: (id: string) => `value-${id}`,
    });
    const store = ensureStore();

    await expect(store.run(() => ensureData(resource, "one"))).resolves.toBe(
      "value-one",
    );
  });

  it("shares an in-flight load instead of starting another", async () => {
    let loads = 0;
    const gate = deferred<string>();
    const resource = dataResource<[string], string>({
      key: (id: string) => ["ensure-shared", id],
      load: () => {
        loads += 1;
        return gate.promise;
      },
    });
    const store = ensureStore();

    const first = store.ensureData(resource, "one");
    const second = store.ensureData(resource, "one");
    gate.resolve("ready");
    await expect(first).resolves.toBe("ready");
    await expect(second).resolves.toBe("ready");
    expect(loads).toBe(1);
  });

  it("returns the stale value and revalidates in the background", async () => {
    let loads = 0;
    const resource = dataResource<[string], string>({
      key: (id: string) => ["ensure-stale", id],
      load: async (id: string) => {
        loads += 1;
        return `v${loads}-${id}`;
      },
    });
    const store = ensureStore();

    await store.ensureData(resource, "one");
    store.invalidateData(resource, "one");
    await expect(store.ensureData(resource, "one")).resolves.toBe("v1-one");
    await waitForNextMacrotask();
    await expect(store.ensureData(resource, "one")).resolves.toBe("v2-one");
    expect(loads).toBe(2);
  });

  it("rejects with the cached load error and retries after invalidation", async () => {
    let attempts = 0;
    const resource = dataResource<[string], string>({
      key: (id: string) => ["ensure-reject", id],
      load: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("load failed");
        return "recovered";
      },
    });
    const store = ensureStore();

    await expect(store.ensureData(resource, "one")).rejects.toThrow(
      "load failed",
    );
    await expect(store.ensureData(resource, "one")).rejects.toThrow(
      "load failed",
    );
    expect(attempts).toBe(1);

    store.invalidateData(resource, "one");
    await expect(store.ensureData(resource, "one")).resolves.toBe("recovered");
  });

  it("retains an unclaimed pending ensure through the preload window", async () => {
    const gate = deferred<string>();
    const signals: AbortSignal[] = [];
    const evicted: string[] = [];
    const resource = dataResource<[string], string>({
      key: (id: string) => ["ensure-retain", id],
      load: (_id, { signal }) => {
        signals.push(signal);
        return gate.promise;
      },
    });
    const store = createDataStore<object, null>({
      getLane: () => null,
      onEntryEvict: (entry) => evicted.push(entry.canonicalKey),
      preloadRetentionMs: 0,
      schedule: () => undefined,
    });

    const pending = store.ensureData(resource, "one");
    // The 0ms preload window elapses while the load is still in flight; the
    // awaiting ensure must keep the entry alive instead of evict-and-abort.
    await waitForNextMacrotask();
    expect(signals[0]?.aborted).toBe(false);
    expect(evicted).toEqual([]);

    gate.resolve("ready");
    await expect(pending).resolves.toBe("ready");
  });

  it("resolves a hydration that supersedes the awaited load", async () => {
    const resource = dataResource<[string], string>({
      key: (id: string) => ["ensure-hydrate", id],
      load: () => never,
    });
    const store = ensureStore();

    const pending = store.ensureData(resource, "one");
    store.hydrate([{ key: ["ensure-hydrate", "one"], value: "pushed" }]);
    await expect(pending).resolves.toBe("pushed");
  });

  it("resolves hydrate-only entries and rejects missing ones", async () => {
    const hydrateOnly = dataResource<[string], string>({
      key: (id: string) => ["ensure-hydrate-only", id],
    });
    const store = ensureStore();

    store.hydrate([
      { key: ["ensure-hydrate-only", "one"], value: "from-server" },
    ]);
    await expect(store.ensureData(hydrateOnly, "one")).resolves.toBe(
      "from-server",
    );
    await expect(store.ensureData(hydrateOnly, "two")).rejects.toThrow(
      "no loader and no hydrated value",
    );
  });

  it("rejects on a disposed store", async () => {
    const resource = dataResource<[string], string>({
      key: (id: string) => ["ensure-disposed", id],
      load: (id: string) => id,
    });
    const store = ensureStore();

    store.dispose();
    await expect(store.ensureData(resource, "one")).rejects.toThrow("disposed");
  });
});

function waitForNextMacrotask(): Promise<void> {
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
