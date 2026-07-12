import { describe, expect, it, vi } from "vitest";
import {
  dataResource,
  invalidateData,
  invalidateDataError,
  invalidateDataKey,
  invalidateDataPrefix,
  preloadData,
  refreshData,
} from "./index.ts";
import { createDataStore, normalizeDataResourceKey } from "./internal.ts";

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
    await delay();

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
    await delay();

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
    await delay();

    expect(store.readData(valueResource, ["one"], owner)).toBe("stale");
    expect(store.inspectDataEntries()).toMatchObject([
      {
        stale: true,
        status: "refreshing",
        value: "stale",
      },
    ]);

    second.resolve("fresh");
    await delay();

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
    await delay();

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
    await delay();

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
    await delay();

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
    await delay();

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
    await delay();

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
    await delay();

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
