import {
  invalidateDataResource,
  markDataResourceError,
  preloadDataResource,
  readDataResource,
  refreshDataResource,
  registerDataStoreFactory,
  resolveCurrentDataStore,
  setCurrentDataStore,
  type DataRefreshResult,
  type DataResourceKey,
  type DataResourceKeyInput,
  type DataResourceLoadContext as FigDataResourceLoadContext,
  type FigDataEntryStatus,
  type FigDataHydrationEntry,
  type FigDataResource,
  type FigDataStore,
  type FigDataStoreEntrySnapshot,
  type FigDataStoreHandle,
} from "@bgub/fig/internal";

declare const process: { env: { NODE_ENV?: string } };

export {
  type DataRefreshResult,
  type DataResourceKey,
  type DataResourceKeyInput,
  type FigDataHydrationEntry,
  type FigDataStoreHandle,
};

declare global {
  namespace FigData {
    // Apps can augment this once to set app-wide data resource types.
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface Register {}
  }
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Register extends FigData.Register {}

export type RegisteredContext = Register extends { context: infer C }
  ? C
  : unknown;

export type DataResourceLoadContext<TStoreContext = RegisteredContext> =
  FigDataResourceLoadContext<TStoreContext>;

export interface DataResourceOptions<
  TArgs extends unknown[],
  TValue,
  TStoreContext = RegisteredContext,
> {
  key: (...args: TArgs) => DataResourceKey;
  load: (
    ...argsAndContext: [...TArgs, DataResourceLoadContext<TStoreContext>]
  ) => TValue | PromiseLike<TValue>;
  debugArgs?: (...args: TArgs) => DataResourceKeyInput;
  name?: string;
}

export type DataResource<
  TArgs extends unknown[] = unknown[],
  TValue = unknown,
  TStoreContext = RegisteredContext,
> = FigDataResource<TArgs, TValue, TStoreContext>;

export interface DataStoreHost<Owner extends object, Lane> {
  context: unknown;
  getLane(): Lane;
  inactiveRetentionMs?: number;
  onEntryChange?: (entry: DataStoreEntrySnapshot) => void;
  onEntryEvict?: (entry: DataStoreEntrySnapshot) => void;
  partition?: DataResourceKeyInput;
  preloadRetentionMs?: number;
  schedule(owner: Owner, lane: Lane): void;
}

export interface DataStore<
  Owner extends object = object,
  Lane = unknown,
> extends FigDataStore {
  readonly host: DataStoreHost<Owner, Lane>;
}

export type DataStoreEntrySnapshot = FigDataStoreEntrySnapshot;

export interface DataResourceFactory {
  <TArgs extends unknown[], TValue, TStoreContext = RegisteredContext>(
    options: DataResourceOptions<TArgs, TValue, TStoreContext>,
  ): DataResource<TArgs, TValue, TStoreContext>;
  identity<TArgs extends unknown[], TValue, TStoreContext = RegisteredContext>(
    options: DataResourceIdentityOptions<TArgs>,
  ): DataResource<TArgs, TValue, TStoreContext>;
  server<TArgs extends unknown[], TValue, TStoreContext>(
    identity: DataResource<TArgs, TValue, TStoreContext>,
    options: DataResourceServerOptions<TArgs, TValue, TStoreContext>,
  ): DataResource<TArgs, TValue, TStoreContext>;
}

export interface DataResourceIdentityOptions<TArgs extends unknown[]> {
  key: (...args: TArgs) => DataResourceKey;
  debugArgs?: (...args: TArgs) => DataResourceKeyInput;
  name?: string;
}

export interface DataResourceServerOptions<
  TArgs extends unknown[],
  TValue,
  TStoreContext = RegisteredContext,
> {
  load: (
    ...argsAndContext: [...TArgs, DataResourceLoadContext<TStoreContext>]
  ) => TValue | PromiseLike<TValue>;
}

interface Entry<Owner extends object, Lane> {
  canonicalKey: string;
  controller: AbortController | null;
  error: unknown;
  fingerprint: string | null;
  generation: number;
  inactiveTimer: TimerHandle | null;
  key: DataResourceKey;
  lane: Lane | null;
  pending: PendingResult<unknown> | null;
  preloadTimer: TimerHandle | null;
  refreshError: unknown;
  resource: DataResource<unknown[], unknown, unknown> | null;
  stale: boolean;
  status: FigDataEntryStatus;
  storeKey: string;
  subscribers: Set<Owner>;
  value: unknown;
}

interface PendingResult<T> {
  promise: Promise<DataRefreshResult<T>>;
  resolve: (result: DataRefreshResult<T>) => void;
}

interface NormalizedKey {
  canonical: string;
  key: DataResourceKey;
}

interface LoadOptions<Lane> {
  lane: Lane;
  refresh: boolean;
}

// Why an in-flight load was aborted: "superseded" by a newer load, the store was
// "store-disposed", or the entry was "evicted" from a live store because nothing
// retained it (retention window elapsed, or last subscriber released).
type AbortReason = "superseded" | "store-disposed" | "evicted";

const DataResourceSymbol = Symbol.for("fig.data-resource");
const DEFAULT_INACTIVE_RETENTION_MS = 5 * 60 * 1000;
const DEFAULT_PRELOAD_RETENTION_MS = 30 * 1000;

type TimerHandle = ReturnType<typeof setTimeout>;

export const dataResource: DataResourceFactory = /* @__PURE__ */ Object.assign(
  function sharedDataResource<
    TArgs extends unknown[],
    TValue,
    TStoreContext = RegisteredContext,
  >(
    options: DataResourceOptions<TArgs, TValue, TStoreContext>,
  ): DataResource<TArgs, TValue, TStoreContext> {
    return createDataResource(options);
  },
  {
    identity<
      TArgs extends unknown[],
      TValue,
      TStoreContext = RegisteredContext,
    >(
      options: DataResourceIdentityOptions<TArgs>,
    ): DataResource<TArgs, TValue, TStoreContext> {
      return createDataResource(options);
    },
    server<TArgs extends unknown[], TValue, TStoreContext>(
      identity: DataResource<TArgs, TValue, TStoreContext>,
      options: DataResourceServerOptions<TArgs, TValue, TStoreContext>,
    ): DataResource<TArgs, TValue, TStoreContext> {
      return createDataResource({
        debugArgs: identity.debugArgs,
        key: identity.key,
        load: options.load,
        name: identity.name,
      });
    },
  },
);

export function readData<TArgs extends unknown[], TValue, TStoreContext>(
  resource: DataResource<TArgs, TValue, TStoreContext>,
  ...args: TArgs
): TValue {
  return readDataResource(resource, args);
}

export function preloadData<TArgs extends unknown[], TValue, TStoreContext>(
  resource: DataResource<TArgs, TValue, TStoreContext>,
  ...args: TArgs
): void {
  preloadDataResource(resource, args);
}

export function invalidateData<TArgs extends unknown[], TValue, TStoreContext>(
  resource: DataResource<TArgs, TValue, TStoreContext>,
  ...args: TArgs
): void {
  invalidateDataResource(resource, args);
}

export function refreshData<TArgs extends unknown[], TValue, TStoreContext>(
  resource: DataResource<TArgs, TValue, TStoreContext>,
  ...args: TArgs
): Promise<DataRefreshResult<TValue>> {
  return refreshDataResource(resource, args);
}

// Captures the ambient store as an explicit handle. Call it synchronously
// wherever Fig is executing — render, event handlers, actions, effects — and
// keep the reference: unlike the free functions above, the handle's methods
// still work after an `await`, where the ambient slot is gone.
export function readDataStore(): FigDataStoreHandle {
  return resolveCurrentDataStore(
    "readDataStore() must be called synchronously while Fig is executing — " +
      "during render, an event handler, an action, or an effect. Capture " +
      "the handle there and use it after awaits.",
  );
}

export function createDataStore<Owner extends object, Lane>(
  host: DataStoreHost<Owner, Lane>,
): DataStore<Owner, Lane> {
  return new DefaultDataStore(host);
}

export function normalizeDataResourceKey(key: DataResourceKey): string {
  return normalizeKey(key).canonical;
}

function createDataResource<TArgs extends unknown[], TValue, TStoreContext>(
  options:
    | DataResourceIdentityOptions<TArgs>
    | DataResourceOptions<TArgs, TValue, TStoreContext>,
): DataResource<TArgs, TValue, TStoreContext> {
  return {
    $$typeof: DataResourceSymbol,
    debugArgs: options.debugArgs,
    key: options.key,
    load: "load" in options ? options.load : undefined,
    name: options.name,
  };
}

class DefaultDataStore<Owner extends object, Lane> implements DataStore<
  Owner,
  Lane
> {
  private readonly entries = new Map<string, Entry<Owner, Lane>>();
  private readonly inactiveRetentionMs: number;
  private readonly ownerKeys = new WeakMap<object, Set<string>>();
  private readonly pendingOwnerKeys = new WeakMap<object, Set<string>>();
  private readonly partitionKey: string;
  private readonly preloadRetentionMs: number;
  private disposed = false;

  constructor(readonly host: DataStoreHost<Owner, Lane>) {
    this.inactiveRetentionMs =
      host.inactiveRetentionMs ?? DEFAULT_INACTIVE_RETENTION_MS;
    this.partitionKey =
      host.partition === undefined
        ? ""
        : encodeValue(host.partition, "partition");
    this.preloadRetentionMs =
      host.preloadRetentionMs ?? DEFAULT_PRELOAD_RETENTION_MS;
  }

  commitDataDependencies(owner: Owner, previousOwner: object | null): void {
    const nextKeys = this.pendingOwnerKeys.get(owner) ?? null;

    // Capture the entries this fiber's generations subscribed to before the
    // delete, then abort any that end up with no retainer once the new owner has
    // re-subscribed. Keys the owner still reads keep at least one subscriber, so
    // only genuinely dropped keys are orphaned.
    const orphanCandidates = new Set<Entry<Owner, Lane>>();
    this.collectSubscribedEntries(owner, orphanCandidates);
    if (previousOwner !== null) {
      this.collectSubscribedEntries(previousOwner, orphanCandidates);
    }

    this.pendingOwnerKeys.delete(owner);
    this.deleteDataOwner(owner);
    if (previousOwner !== null) this.deleteDataOwner(previousOwner);

    if (nextKeys !== null && nextKeys.size > 0) {
      this.ownerKeys.set(owner, nextKeys);

      for (const key of nextKeys) {
        const entry = this.entries.get(key);
        if (entry !== undefined) {
          this.clearInactiveTimer(entry);
          entry.subscribers.add(owner);
          this.notifyEntryChange(entry);
        }
      }
    }

    for (const entry of orphanCandidates) this.abortOrphanedLoad(entry);
  }

  releaseDataOwner(owner: object): void {
    // The genuine-deletion path (fiber unmount). Unlike deleteDataOwner, which
    // is also used for transient commit churn, this aborts in-flight loads left
    // with no retainer so an unmounted subtree does not keep fetching.
    const orphanCandidates = new Set<Entry<Owner, Lane>>();
    this.collectSubscribedEntries(owner, orphanCandidates);
    this.deleteDataOwner(owner);
    for (const entry of orphanCandidates) this.abortOrphanedLoad(entry);
  }

  resetDataDependencies(owner: object): void {
    // Reads accumulate into pendingOwnerKeys as a render runs. A render attempt
    // can be abandoned before commit (suspense retry, concurrent interruption,
    // the strict shadow pass), and the work-in-progress fiber object is reused
    // across attempts, so the keys must be cleared at the start of each render
    // or stale dependencies from a discarded attempt would be committed.
    this.pendingOwnerKeys.delete(owner);
  }

  deleteDataOwner(owner: object): void {
    this.pendingOwnerKeys.delete(owner);
    const keys = this.ownerKeys.get(owner);
    if (keys === undefined) return;

    this.ownerKeys.delete(owner);
    for (const key of keys) {
      const entry = this.entries.get(key);
      if (entry === undefined) continue;

      entry.subscribers.delete(owner as Owner);
      this.notifyEntryChange(entry);
      this.scheduleInactiveCleanup(entry);
    }
  }

  private collectSubscribedEntries(
    owner: object,
    into: Set<Entry<Owner, Lane>>,
  ): void {
    const keys = this.ownerKeys.get(owner);
    if (keys === undefined) return;

    for (const key of keys) {
      const entry = this.entries.get(key);
      if (entry !== undefined) into.add(entry);
    }
  }

  private abortOrphanedLoad(entry: Entry<Owner, Lane>): void {
    // Only a value-less in-flight load (a cache-miss "pending" entry) with no
    // committed subscriber and no preload retainer is safe to drop: it has no
    // value to lose, and any reader of such a key suspends rather than commits,
    // so it cannot be handed off to a sibling mid-commit. Value-bearing entries
    // are left alone — a "refreshing" entry still serves a usable value, and its
    // refresh settles into the normal inactive-retention path. Evicting those
    // would discard a live value or strand a sibling that read it without
    // suspending.
    if (this.entries.get(entry.storeKey) !== entry) return;
    if (
      entry.subscribers.size > 0 ||
      entry.preloadTimer !== null ||
      entry.pending === null ||
      entryHasValue(entry)
    ) {
      return;
    }

    this.evictEntry(entry, "evicted");
  }

  dispose(): void {
    this.disposed = true;

    for (const entry of this.entries.values()) {
      this.clearInactiveTimer(entry);
      this.clearPreloadTimer(entry);
      this.abortActiveLoad(entry, "store-disposed");
      this.notifyEntryChange(entry);
    }
  }

  hydrate(entries: readonly FigDataHydrationEntry[]): void {
    for (const hydrated of entries) {
      const normalized = normalizeKey(hydrated.key);
      const storeKey = this.storeKey(normalized.canonical);
      const current = this.entries.get(storeKey);

      if (current !== undefined) {
        this.hydrateEntry(current, normalized.key, hydrated.value);
        this.publish(current);
        continue;
      }

      const entry = this.createEntry(
        normalized,
        storeKey,
        null,
        null,
        "fulfilled",
        hydrated.value,
      );
      this.entries.set(storeKey, entry);
      this.notifyEntryChange(entry);
    }
  }

  snapshot(): FigDataHydrationEntry[] {
    const entries: FigDataHydrationEntry[] = [];

    for (const entry of this.entries.values()) {
      if (entryHasValue(entry))
        entries.push({ key: entry.key, value: entry.value });
    }

    return entries;
  }

  inspectDataEntries(): FigDataStoreEntrySnapshot[] {
    return Array.from(this.entries.values(), (entry) =>
      this.snapshotEntry(entry),
    );
  }

  invalidateData<TArgs extends unknown[], TValue, TStoreContext>(
    resource: DataResource<TArgs, TValue, TStoreContext>,
    ...args: TArgs
  ): void {
    if (this.disposed) return;

    const { entry } = this.entryFor(resource, args, false);
    if (entry === null) return;

    entry.stale = true;
    // Clearing the prior refresh failure re-enables auto-refresh-on-read; an
    // explicit invalidation is a fresh "this is stale, fetch again" intent.
    entry.refreshError = undefined;
    if (entry.status === "rejected") {
      // The same intent applies to a cached rejection: without this, every
      // read rethrows the old error forever — remounting an ErrorBoundary
      // could never recover. Back to pending, so the next read loads afresh.
      entry.error = undefined;
      entry.status = "pending";
    }
    this.notifyEntryChange(entry);
    if (entry.subscribers.size === 0) return;

    this.scheduleSubscribers(entry, this.host.getLane());
  }

  preloadData<TArgs extends unknown[], TValue, TStoreContext>(
    resource: DataResource<TArgs, TValue, TStoreContext>,
    ...args: TArgs
  ): void {
    if (this.disposed || resource.load === undefined) return;

    const { entry } = this.entryFor(resource, args, true);
    this.clearInactiveTimer(entry);
    this.retainPreload(entry);
    if (entry.pending !== null) return;
    if (entry.status === "fulfilled" && !entry.stale) return;

    void this.startLoad(entry, resource, args, {
      lane: this.host.getLane(),
      refresh: entry.status === "fulfilled",
    });
  }

  readData<TArgs extends unknown[], TValue, TStoreContext>(
    resource: DataResource<TArgs, TValue, TStoreContext>,
    args: TArgs,
    owner: Owner,
  ): TValue {
    const { entry, key } = this.entryFor(resource, args, true);
    this.clearInactiveTimer(entry);
    this.clearPreloadTimer(entry);
    this.addOwnerKey(owner, key);

    if (
      entry.status === "fulfilled" &&
      entry.stale &&
      entry.pending === null &&
      entry.refreshError === undefined &&
      resource.load !== undefined
    ) {
      // A failed background refresh keeps the stale value and records
      // refreshError; do not auto-retry on every subsequent read or a
      // persistently-failing loader becomes a render/fetch storm. An explicit
      // invalidateData/refreshData clears refreshError to retry.
      void this.startLoad(entry, resource, args, {
        lane: this.host.getLane(),
        refresh: true,
      });
    }

    if (entry.status === "pending" && entry.pending === null) {
      void this.startLoad(entry, resource, args, {
        lane: this.host.getLane(),
        refresh: false,
      });
    }

    return this.readCurrentValue(entry, resource);
  }

  refreshData<TArgs extends unknown[], TValue, TStoreContext>(
    resource: DataResource<TArgs, TValue, TStoreContext>,
    ...args: TArgs
  ): Promise<DataRefreshResult<TValue>> {
    if (this.disposed) {
      return Promise.resolve({
        reason: "store-disposed",
        staleValue: undefined,
        status: "aborted",
      });
    }

    if (resource.load === undefined) {
      const { entry } = this.entryFor(resource, args, false);
      if (entry === null) {
        return Promise.resolve(unsupportedRefreshResult<TValue>());
      }

      this.clearInactiveTimer(entry);
      return Promise.resolve(unsupportedRefreshResult<TValue>(entry));
    }

    const { entry } = this.entryFor(resource, args, true);
    this.clearInactiveTimer(entry);

    if (entry.pending !== null && entry.status !== "refreshing") {
      return entry.pending.promise as Promise<DataRefreshResult<TValue>>;
    }

    return this.startLoad(entry, resource, args, {
      lane: this.host.getLane(),
      refresh: entry.status === "fulfilled" || entry.status === "refreshing",
    }) as Promise<DataRefreshResult<TValue>>;
  }

  run<T>(callback: () => T): T {
    const previousStore = setCurrentDataStore(this);
    try {
      return callback();
    } finally {
      setCurrentDataStore(previousStore);
    }
  }

  private addOwnerKey(owner: Owner, key: string): void {
    let keys = this.pendingOwnerKeys.get(owner);
    if (keys === undefined) {
      keys = new Set();
      this.pendingOwnerKeys.set(owner, keys);
    }

    keys.add(key);
  }

  private entryFor<TArgs extends unknown[], TValue, TStoreContext>(
    resource: DataResource<TArgs, TValue, TStoreContext>,
    args: TArgs,
    create: true,
  ): { entry: Entry<Owner, Lane>; key: string };
  private entryFor<TArgs extends unknown[], TValue, TStoreContext>(
    resource: DataResource<TArgs, TValue, TStoreContext>,
    args: TArgs,
    create: false,
  ): { entry: Entry<Owner, Lane> | null; key: string };
  private entryFor<TArgs extends unknown[], TValue, TStoreContext>(
    resource: DataResource<TArgs, TValue, TStoreContext>,
    args: TArgs,
    create: boolean,
  ): { entry: Entry<Owner, Lane> | null; key: string } {
    const normalized = normalizeKey(resource.key(...args));
    // The fingerprint feeds only the dev drift diagnostics below, so
    // production never pays for encoding the args on every read.
    const fingerprint =
      process.env.NODE_ENV !== "production"
        ? fingerprintFor(resource, args)
        : null;
    const key = this.storeKey(normalized.canonical);
    const current = this.entries.get(key);

    if (current !== undefined) {
      if (process.env.NODE_ENV !== "production") {
        diagnoseEntryDrift(
          current,
          resource,
          normalized.canonical,
          fingerprint,
        );
      }
      return { entry: current, key };
    }

    if (!create) return { entry: null, key };

    const entry = this.createEntry(
      normalized,
      key,
      resource as DataResource<unknown[], unknown, unknown>,
      fingerprint,
      "pending",
      undefined,
    );
    // A disposed store is terminal: hand back a transient entry but never
    // register it, so post-dispose reads cannot resurrect the cache.
    if (this.disposed) return { entry, key };

    this.entries.set(key, entry);
    this.notifyEntryChange(entry);
    return { entry, key };
  }

  private createEntry(
    normalized: NormalizedKey,
    storeKey: string,
    resource: DataResource<unknown[], unknown, unknown> | null,
    fingerprint: string | null,
    status: FigDataEntryStatus,
    value: unknown,
  ): Entry<Owner, Lane> {
    return {
      canonicalKey: normalized.canonical,
      controller: null,
      error: undefined,
      fingerprint,
      generation: 0,
      inactiveTimer: null,
      key: normalized.key,
      lane: null,
      pending: null,
      preloadTimer: null,
      refreshError: undefined,
      resource,
      stale: false,
      status,
      storeKey,
      subscribers: new Set(),
      value,
    };
  }

  private hydrateEntry(
    entry: Entry<Owner, Lane>,
    key: DataResourceKey,
    value: unknown,
  ): void {
    this.clearInactiveTimer(entry);
    this.abortActiveLoad(entry, "superseded");
    entry.error = undefined;
    entry.generation += 1;
    entry.key = key;
    entry.refreshError = undefined;
    entry.stale = false;
    entry.status = "fulfilled";
    entry.value = value;
  }

  private storeKey(canonicalKey: string): string {
    return this.partitionKey === ""
      ? canonicalKey
      : `${this.partitionKey}:${canonicalKey}`;
  }

  private startLoad<TArgs extends unknown[], TValue, TStoreContext>(
    entry: Entry<Owner, Lane>,
    resource: DataResource<TArgs, TValue, TStoreContext>,
    args: TArgs,
    options: LoadOptions<Lane>,
  ): Promise<DataRefreshResult<TValue>> {
    const hadValue = entryHasValue(entry);

    if (this.disposed) {
      return Promise.resolve(abortedRefreshResult(entry, "store-disposed"));
    }

    if (resource.load === undefined) {
      const error = new Error(
        `Data resource "${resource.name ?? entry.canonicalKey}" has no loader and no hydrated value.`,
      );
      entry.error = error;
      entry.status = "rejected";
      markDataResourceError(error, entry.key);
      this.notifyEntryChange(entry);
      return Promise.resolve(unsupportedRefreshResult<TValue>(entry));
    }

    this.abortActiveLoad(entry, "superseded");
    const controller = new AbortController();
    const generation = entry.generation + 1;
    const pending = createPendingResult<TValue>();

    entry.controller = controller;
    entry.generation = generation;
    entry.lane = options.lane;
    entry.pending = pending as PendingResult<unknown>;
    entry.status = options.refresh && hadValue ? "refreshing" : "pending";
    this.notifyEntryChange(entry);

    let loaded: TValue | PromiseLike<TValue>;
    try {
      loaded = resource.load(...args, {
        context: this.host.context as TStoreContext,
        signal: controller.signal,
      });
    } catch (error) {
      loaded = Promise.reject(error);
    }

    const settleAborted = (): DataRefreshResult<TValue> => {
      const result = abortedRefreshResult<TValue, Owner, Lane>(
        entry,
        "superseded",
      );
      settlePendingResult(pending, result);
      return result;
    };
    const fulfill = (value: TValue): DataRefreshResult<TValue> => {
      if (entry.generation !== generation || controller.signal.aborted) {
        return settleAborted();
      }

      entry.controller = null;
      entry.error = undefined;
      entry.pending = null;
      entry.refreshError = undefined;
      entry.stale = false;
      entry.status = "fulfilled";
      entry.value = value;
      this.publish(entry);
      const result: DataRefreshResult<TValue> = { status: "fulfilled", value };
      settlePendingResult(pending, result);
      return result;
    };
    const reject = (error: unknown): DataRefreshResult<TValue> => {
      if (entry.generation !== generation || controller.signal.aborted) {
        return settleAborted();
      }

      entry.controller = null;
      entry.pending = null;

      if (hadValue) {
        entry.refreshError = error;
        entry.stale = true;
        entry.status = "fulfilled";
        this.publish(entry);
        const result: DataRefreshResult<TValue> = {
          error,
          staleValue: entry.value as TValue,
          status: "rejected",
        };
        settlePendingResult(pending, result);
        return result;
      }

      entry.error = error;
      entry.status = "rejected";
      markDataResourceError(error, entry.key);
      this.publish(entry);
      const result: DataRefreshResult<TValue> = { error, status: "rejected" };
      settlePendingResult(pending, result);
      return result;
    };

    if (!isThenable(loaded)) {
      fulfill(loaded);
      return pending.promise;
    }

    void Promise.resolve(loaded).then(fulfill, reject);

    return pending.promise;
  }

  private publish(entry: Entry<Owner, Lane>): void {
    this.notifyEntryChange(entry);
    this.scheduleInactiveCleanup(entry);

    this.scheduleSubscribers(entry, entry.lane ?? this.host.getLane());
  }

  private scheduleSubscribers(entry: Entry<Owner, Lane>, lane: Lane): void {
    for (const subscriber of entry.subscribers) {
      this.host.schedule(subscriber, lane);
    }
  }

  private abortActiveLoad(
    entry: Entry<Owner, Lane>,
    reason: AbortReason,
  ): void {
    const pending = entry.pending;
    if (pending === null) return;

    entry.controller?.abort();
    entry.controller = null;
    entry.pending = null;
    settlePendingResult(pending, abortedRefreshResult(entry, reason));
  }

  private retainPreload(entry: Entry<Owner, Lane>): void {
    this.clearPreloadTimer(entry);
    if (this.disposed || !Number.isFinite(this.preloadRetentionMs)) return;

    entry.preloadTimer = scheduleStoreTimer(
      () => {
        entry.preloadTimer = null;
        if (entry.subscribers.size === 0 && entry.pending !== null) {
          this.evictEntry(entry, "evicted");
          return;
        }
        this.scheduleInactiveCleanup(entry);
      },
      Math.max(0, this.preloadRetentionMs),
    );
  }

  private scheduleInactiveCleanup(entry: Entry<Owner, Lane>): void {
    if (
      this.disposed ||
      entry.subscribers.size > 0 ||
      entry.pending !== null ||
      entry.preloadTimer !== null ||
      !Number.isFinite(this.inactiveRetentionMs)
    ) {
      return;
    }

    this.clearInactiveTimer(entry);
    entry.inactiveTimer = scheduleStoreTimer(
      () => {
        entry.inactiveTimer = null;
        if (
          entry.subscribers.size > 0 ||
          entry.pending !== null ||
          entry.preloadTimer !== null
        ) {
          return;
        }
        this.evictEntry(entry, "evicted");
      },
      Math.max(0, this.inactiveRetentionMs),
    );
  }

  private evictEntry(entry: Entry<Owner, Lane>, reason: AbortReason): void {
    if (this.entries.get(entry.storeKey) !== entry) return;

    this.clearInactiveTimer(entry);
    this.clearPreloadTimer(entry);
    this.abortActiveLoad(entry, reason);
    this.entries.delete(entry.storeKey);
    this.host.onEntryEvict?.(this.snapshotEntry(entry));
  }

  private clearInactiveTimer(entry: Entry<Owner, Lane>): void {
    if (entry.inactiveTimer === null) return;

    clearTimeout(entry.inactiveTimer);
    entry.inactiveTimer = null;
  }

  private clearPreloadTimer(entry: Entry<Owner, Lane>): void {
    if (entry.preloadTimer === null) return;

    clearTimeout(entry.preloadTimer);
    entry.preloadTimer = null;
  }

  private notifyEntryChange(entry: Entry<Owner, Lane>): void {
    this.host.onEntryChange?.(this.snapshotEntry(entry));
  }

  private snapshotEntry(entry: Entry<Owner, Lane>): DataStoreEntrySnapshot {
    const hasValue = entryHasValue(entry);
    return {
      canonicalKey: entry.canonicalKey,
      error: entry.status === "rejected" ? entry.error : undefined,
      hasValue,
      key: entry.key,
      name: entry.resource?.name,
      pending: entry.pending !== null,
      refreshError: entry.refreshError,
      stale: entry.stale,
      status: entry.status,
      subscriberCount: entry.subscribers.size,
      value: hasValue ? entry.value : undefined,
    };
  }

  private readCurrentValue<TValue, TArgs extends unknown[], TStoreContext>(
    entry: Entry<Owner, Lane>,
    resource: DataResource<TArgs, TValue, TStoreContext>,
  ): TValue {
    if (entryHasValue(entry)) {
      return entry.value as TValue;
    }

    if (entry.status === "rejected") throwDataResourceError(entry);

    if (entry.pending === null) {
      throw new Error(
        `Data resource "${resource.name ?? entry.canonicalKey}" has no pending load.`,
      );
    }

    throw entry.pending.promise;
  }
}

function normalizeKey(key: DataResourceKey): NormalizedKey {
  if (!Array.isArray(key) || typeof key[0] !== "string") {
    throw new Error(
      "Data resource keys must be arrays starting with a string.",
    );
  }

  return {
    canonical: encodeArray(key, "key"),
    key,
  };
}

function entryHasValue<Owner extends object, Lane>(
  entry: Entry<Owner, Lane>,
): boolean {
  return entry.status === "fulfilled" || entry.status === "refreshing";
}

function throwDataResourceError<Owner extends object, Lane>(
  entry: Entry<Owner, Lane>,
): never {
  markDataResourceError(entry.error, entry.key);
  throw entry.error;
}

function abortedRefreshResult<T, Owner extends object, Lane>(
  entry: Entry<Owner, Lane>,
  reason: AbortReason,
): DataRefreshResult<T> {
  return {
    reason,
    staleValue: entryHasValue(entry) ? (entry.value as T) : undefined,
    status: "aborted",
  };
}

function unsupportedRefreshResult<
  T,
  Owner extends object = object,
  Lane = unknown,
>(entry?: Entry<Owner, Lane>): DataRefreshResult<T> {
  const result: DataRefreshResult<T> = {
    reason: "no-client-loader",
    status: "unsupported",
  };

  if (entry !== undefined) {
    result.staleValue = entryHasValue(entry) ? (entry.value as T) : undefined;
  }

  return result;
}

function fingerprintFor<TArgs extends unknown[], TValue, TStoreContext>(
  resource: DataResource<TArgs, TValue, TStoreContext>,
  args: TArgs,
): string | null {
  if (resource.debugArgs !== undefined) {
    return encodeValue(resource.debugArgs(...args), "debugArgs");
  }

  try {
    return encodeArray(args, "args");
  } catch {
    return null;
  }
}

function diagnoseEntryDrift<
  Owner extends object,
  Lane,
  TArgs extends unknown[],
  TValue,
  TStoreContext,
>(
  entry: Entry<Owner, Lane>,
  resource: DataResource<TArgs, TValue, TStoreContext>,
  key: string,
  fingerprint: string | null,
): void {
  if (process.env.NODE_ENV === "production") return;

  if (entry.resource === null) {
    entry.resource = resource as DataResource<unknown[], unknown, unknown>;
  } else if (entry.resource !== resource) {
    warn(`Data resource key ${key} was read by multiple resource definitions.`);
  }

  if (
    entry.fingerprint !== null &&
    fingerprint !== null &&
    entry.fingerprint !== fingerprint
  ) {
    warn(
      `Data resource key ${key} was read with different argument fingerprints.`,
    );
  }
}

function warn(message: string): void {
  if (typeof console === "undefined") return;
  console.warn(message);
}

function encodeArray(values: readonly unknown[], path: string): string {
  return `[${values.map((value, index) => encodeValue(value, `${path}[${index}]`)).join(",")}]`;
}

function encodeObject(value: object, path: string): string {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`Invalid data resource key value at ${path}.`);
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const parts: string[] = [];

  for (const key of keys) {
    const child = record[key];
    if (child === undefined) {
      throw new Error(`Invalid undefined data resource key value at ${path}.`);
    }
    parts.push(
      `${JSON.stringify(key)}:${encodeValue(child, `${path}.${key}`)}`,
    );
  }

  return `{${parts.join(",")}}`;
}

function encodeValue(value: unknown, path: string): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new Error(`Invalid number in data resource key at ${path}.`);
      }
      return Object.is(value, -0) ? "0" : JSON.stringify(value);
    case "object":
      if (Array.isArray(value)) return encodeArray(value, path);
      return encodeObject(value, path);
    default:
      throw new Error(`Invalid data resource key value at ${path}.`);
  }
}

function isThenable<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as PromiseLike<T>).then === "function"
  );
}

function createPendingResult<T>(): PendingResult<T> {
  let resolve: (result: DataRefreshResult<T>) => void = () => undefined;
  const promise = new Promise<DataRefreshResult<T>>((settle) => {
    resolve = settle;
  });

  return {
    promise,
    resolve,
  };
}

function settlePendingResult<T>(
  pending: PendingResult<T>,
  result: DataRefreshResult<T>,
): void {
  pending.resolve(result);
}

function scheduleStoreTimer(callback: () => void, delay: number): TimerHandle {
  const timer = setTimeout(callback, delay);
  const unref = (timer as { unref?: () => void }).unref;
  if (unref !== undefined) unref.call(timer);
  return timer;
}

export function runWithDataStore<T>(store: FigDataStore, callback: () => T): T {
  return store.run(callback);
}

export function currentDataStore(): FigDataStore {
  return resolveCurrentDataStore();
}

// Module side effect (reflected in package.json "sideEffects"): loading this
// package hands renderers the real store factory. Renderer bundles carry only
// a stub until then, and roots created earlier upgrade in place — see
// registerDataStoreFactory in @bgub/fig/internal.
registerDataStoreFactory((host) =>
  createDataStore(host as DataStoreHost<object, unknown>),
);
