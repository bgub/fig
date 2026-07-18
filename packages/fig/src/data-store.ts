import {
  type DataRefreshResult,
  type DataResource,
  type DataResourceKey,
  type DataResourceKeyInput,
  type DataResourceLoadContext,
  type DataResourceLoader,
  type DataStoreEntrySnapshot,
  dataResourceKeysForError,
  defineLoadContextCapabilities,
  type FigDataEntryStatus,
  type FigDataHydrationEntry,
  type FigDataStore,
  type FigDataStoreController,
  type FigDataStoreFactory,
  type FigDataStoreHandle,
  type FigDataStoreHost,
  type FigDataStoreOptions,
  isAttributableError,
  markDataResourceError,
  resolveCurrentDataStore,
  setCurrentDataStore,
} from "./data.ts";

declare const __FIG_DEV__: boolean | undefined;

export interface DataResourceOptions<TArgs extends unknown[], TValue> {
  key: (...args: TArgs) => DataResourceKey;
  debugArgs?: (...args: TArgs) => DataResourceKeyInput;
  load?: DataResourceLoader<TArgs, TValue>;
}

export interface DataStoreHost<Owner extends object, Lane> {
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

interface Entry<Owner extends object, Lane> {
  canonicalKey: string;
  // The in-flight load's controller (null when no load is pending).
  controller: AbortController | null;
  // The authoritative generation's controller — the load whose value the
  // entry holds. Deliberately retained after that loader settles: the
  // signal's lifetime is the generation's authority, not the pending
  // promise's, so loaders that keep streaming into their value (payload
  // decodes filling holes) learn when a SUCCESSOR becomes authoritative, a
  // server push hydrates over them, the entry evicts, or the store is
  // disposed. A superseding load that starts does not abort it — a visible
  // stale value keeps streaming through the refresh window, and a failed
  // refresh leaves it fully alive.
  valueController: AbortController | null;
  // Errors rejected by streamed holes inside the authoritative fulfilled
  // value. Invalidating one retires that broken value instead of serving it
  // stale into a freshly remounted ErrorBoundary.
  valueErrors: WeakSet<object>;
  // Count of ensureData calls currently awaiting this entry's load. A
  // retainer like a subscriber or the preload timer: an awaited ensure must
  // not be evicted-and-aborted out from under its caller mid-load.
  ensureRetainers: number;
  error: unknown;
  fingerprint: string | null;
  generation: number;
  invalidationVersion: number;
  inactiveTimer: TimerHandle | null;
  key: DataResourceKey;
  lane: Lane | null;
  pending: PendingResult<unknown> | null;
  preloadTimer: TimerHandle | null;
  refreshError: unknown;
  resource: DataResource<unknown[], unknown> | null;
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

interface EncodePath {
  root: string;
  segments: Array<string | number>;
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
const DataStoreFactorySymbol = Symbol.for("fig.data-store-factory");
const DataStoreControllerSymbol = Symbol.for("fig.data-store-controller");
const DEFAULT_INACTIVE_RETENTION_MS = 5 * 60 * 1000;
const DEFAULT_PRELOAD_RETENTION_MS = 30 * 1000;
const __DEV__ = typeof __FIG_DEV__ === "boolean" ? __FIG_DEV__ : false;

type TimerHandle = ReturnType<typeof setTimeout>;

const dataStoreFactory = createRendererDataStore as FigDataStoreFactory;

export function dataResource<TArgs extends unknown[], TValue>(
  options: DataResourceOptions<TArgs, TValue>,
): DataResource<TArgs, TValue> {
  const resource = {
    $$typeof: DataResourceSymbol,
    debugArgs: options.debugArgs,
    key: options.key,
    load: options.load,
  };
  (
    resource as DataResource<TArgs, TValue> &
      Record<symbol, FigDataStoreFactory>
  )[DataStoreFactorySymbol] = dataStoreFactory;
  return resource;
}

export function ensureData<TArgs extends unknown[], TValue>(
  resource: DataResource<TArgs, TValue>,
  ...args: TArgs
): Promise<TValue> {
  return resolveDataMutationStore("ensureData").ensureData(resource, ...args);
}

export function invalidateData<TArgs extends unknown[], TValue>(
  resource: DataResource<TArgs, TValue>,
  ...args: TArgs
): void {
  resolveDataMutationStore("invalidateData").invalidateData(resource, ...args);
}

export function invalidateDataError(error: unknown): boolean {
  return resolveDataMutationStore("invalidateDataError").invalidateDataError(
    error,
  );
}

export function invalidateDataKey(key: DataResourceKey): void {
  resolveDataMutationStore("invalidateDataKey").invalidateDataKey(key);
}

export function invalidateDataPrefix(prefix: DataResourceKey): void {
  resolveDataMutationStore("invalidateDataPrefix").invalidateDataPrefix(prefix);
}

export function refreshData<TArgs extends unknown[], TValue>(
  resource: DataResource<TArgs, TValue>,
  ...args: TArgs
): Promise<DataRefreshResult<TValue>> {
  return resolveDataMutationStore("refreshData").refreshData(resource, ...args);
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

interface DataStoreControllerState {
  attached: boolean;
  host: FigDataStoreHost;
}

export function createDataStore(
  options: FigDataStoreOptions = {},
): FigDataStoreController {
  const detachedHost: FigDataStoreHost = {
    getLane: () => null,
    partition: options.partition,
    schedule: () => undefined,
  };
  const state: DataStoreControllerState = {
    attached: false,
    host: detachedHost,
  };
  const forwardingHost: FigDataStoreHost = {
    getLane: () => state.host.getLane(),
    partition: options.partition,
    schedule: (owner, lane) => state.host.schedule(owner, lane),
  };
  const store = createRendererDataStore(forwardingHost);
  Object.defineProperty(store, DataStoreControllerSymbol, { value: state });
  if (options.initialData !== undefined) store.hydrate(options.initialData);
  return store;
}

export function attachDataStore(
  controller: FigDataStoreController,
  host: FigDataStoreHost,
  initialData?: readonly FigDataHydrationEntry[],
): FigDataStore {
  if (host.partition !== undefined || initialData !== undefined) {
    throw new Error(
      "Pass partition and initialData to createDataStore(), not the renderer, when adopting a data store.",
    );
  }
  const state = (
    controller as FigDataStoreController &
      Record<symbol, DataStoreControllerState | undefined>
  )[DataStoreControllerSymbol];
  if (state === undefined) {
    throw new Error("dataStore must be created with createDataStore().");
  }
  if (state.attached) {
    throw new Error("A data store can only be adopted by one Fig renderer.");
  }
  state.attached = true;
  state.host = host;
  return controller as FigDataStore;
}

function resolveDataMutationStore(name: string): FigDataStore {
  return resolveCurrentDataStore(
    `${name}() must be called synchronously while Fig is executing — ` +
      "during render, an event handler, an action, or an effect. Capture " +
      "readDataStore() (or root.data) synchronously and call the handle instead.",
  );
}

export function createRendererDataStore<Owner extends object, Lane>(
  host: DataStoreHost<Owner, Lane>,
): DataStore<Owner, Lane> {
  return new DefaultDataStore(host);
}

export function normalizeDataResourceKey(key: DataResourceKey): string {
  return normalizeKey(key).canonical;
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
        : encodeValue(host.partition, createEncodePath("partition"));
    this.preloadRetentionMs =
      host.preloadRetentionMs ?? DEFAULT_PRELOAD_RETENTION_MS;
  }

  commitDataDependencies(owner: Owner, previousOwner: object | null): void {
    const nextKeys = this.pendingOwnerKeys.get(owner) ?? null;
    const ownerKeys = this.ownerKeys.get(owner) ?? null;
    const previousOwnerKeys =
      previousOwner === null
        ? null
        : (this.ownerKeys.get(previousOwner) ?? null);
    this.pendingOwnerKeys.delete(owner);

    if (
      (nextKeys === null || nextKeys.size === 0) &&
      ownerKeys === null &&
      previousOwnerKeys === null
    ) {
      return;
    }

    // Capture the entries this fiber's generations subscribed to before the
    // delete, then abort any that end up with no retainer once the new owner has
    // re-subscribed. Keys the owner still reads keep at least one subscriber, so
    // only genuinely dropped keys are orphaned.
    let orphanCandidates: Set<Entry<Owner, Lane>> | null = null;
    orphanCandidates = this.collectSubscribedEntries(
      ownerKeys,
      orphanCandidates,
    );
    orphanCandidates = this.collectSubscribedEntries(
      previousOwnerKeys,
      orphanCandidates,
    );

    this.deleteDataOwner(owner, nextKeys);
    if (previousOwner !== null) this.deleteDataOwner(previousOwner, nextKeys);

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

    if (orphanCandidates !== null) {
      for (const entry of orphanCandidates) this.abortOrphanedLoad(entry);
    }
  }

  releaseDataOwner(owner: object): void {
    // The genuine-deletion path (fiber unmount). Unlike deleteDataOwner, which
    // is also used for transient commit churn, this aborts in-flight loads left
    // with no retainer so an unmounted subtree does not keep fetching.
    const orphanCandidates = this.collectSubscribedEntries(
      this.ownerKeys.get(owner) ?? null,
      null,
    );
    this.deleteDataOwner(owner);
    if (orphanCandidates !== null) {
      for (const entry of orphanCandidates) this.abortOrphanedLoad(entry);
    }
  }

  resetDataDependencies(owner: object): void {
    // Reads accumulate into pendingOwnerKeys as a render runs. A render attempt
    // can be abandoned before commit (suspense retry, concurrent interruption,
    // the strict shadow pass), and the work-in-progress fiber object is reused
    // across attempts, so the keys must be cleared at the start of each render
    // or stale dependencies from a discarded attempt would be committed.
    this.pendingOwnerKeys.delete(owner);
  }

  deleteDataOwner(
    owner: object,
    retainedKeys: ReadonlySet<string> | null = null,
  ): void {
    this.pendingOwnerKeys.delete(owner);
    const keys = this.ownerKeys.get(owner);
    if (keys === undefined) return;

    this.ownerKeys.delete(owner);
    for (const key of keys) {
      const entry = this.entries.get(key);
      if (entry === undefined) continue;

      entry.subscribers.delete(owner as Owner);
      this.notifyEntryChange(entry);
      if (retainedKeys?.has(key) !== true) this.scheduleInactiveCleanup(entry);
    }
  }

  private collectSubscribedEntries(
    keys: ReadonlySet<string> | null,
    into: Set<Entry<Owner, Lane>> | null,
  ): Set<Entry<Owner, Lane>> | null {
    if (keys === null) return into;

    for (const key of keys) {
      const entry = this.entries.get(key);
      if (entry !== undefined) {
        into ??= new Set();
        into.add(entry);
      }
    }

    return into;
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
      entry.ensureRetainers > 0 ||
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
      this.abortEntryGenerations(entry, "store-disposed");
      this.notifyEntryChange(entry);
    }
  }

  hydrate(entries: readonly FigDataHydrationEntry[]): void {
    if (this.disposed) return;

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

  inspectDataEntries(): DataStoreEntrySnapshot[] {
    return Array.from(this.entries.values(), (entry) =>
      this.snapshotEntry(entry),
    );
  }

  inspectDataDependencyCanonicalKeys(owner: object): string[] {
    // Inspection surface only (devtools snapshots are dev-gated); returns
    // empty in prod even though ownerKeys is populated there.
    if (!__DEV__) return [];

    const keys = this.ownerKeys.get(owner);
    if (keys === undefined) return [];

    const dependencies: string[] = [];
    for (const key of keys) {
      const entry = this.entries.get(key);
      if (entry !== undefined) dependencies.push(entry.canonicalKey);
    }
    return dependencies;
  }

  invalidateData<TArgs extends unknown[], TValue>(
    resource: DataResource<TArgs, TValue>,
    ...args: TArgs
  ): void {
    if (this.disposed) return;

    const { entry } = this.entryFor(resource, args, false);
    if (entry === null) return;

    this.invalidateEntry(entry, this.host.getLane());
  }

  invalidateDataError(error: unknown): boolean {
    if (this.disposed) return false;

    const keys = dataResourceKeysForError(error);
    if (keys === undefined || keys.length === 0) return false;

    const entries: Entry<Owner, Lane>[] = [];
    for (const key of keys) {
      const entry = this.entryForKey(key);
      if (entry !== null) entries.push(entry);
    }

    this.invalidateEntries(entries, error);
    return true;
  }

  invalidateDataKey(key: DataResourceKey): void {
    if (this.disposed) return;

    const entry = this.entryForKey(key);
    if (entry === null) return;

    this.invalidateEntry(entry, this.host.getLane());
  }

  invalidateDataPrefix(prefix: DataResourceKey): void {
    if (this.disposed) return;

    const prefixCanonical = normalizeKey(prefix).canonical;
    const entries: Entry<Owner, Lane>[] = [];
    for (const entry of this.entries.values()) {
      if (canonicalKeyStartsWith(entry.canonicalKey, prefixCanonical)) {
        entries.push(entry);
      }
    }

    this.invalidateEntries(entries);
  }

  async ensureData<TArgs extends unknown[], TValue>(
    resource: DataResource<TArgs, TValue>,
    ...args: TArgs
  ): Promise<TValue> {
    for (;;) {
      if (this.disposed) {
        throw new Error(
          "ensureData() requires a live data store; this store was disposed.",
        );
      }

      const { entry } = this.entryFor(resource, args, true);
      this.clearInactiveTimer(entry);
      this.retainPreload(entry);

      if (entryHasValue(entry)) {
        if (
          entry.status === "fulfilled" &&
          entry.stale &&
          entry.pending === null &&
          entry.refreshError === undefined &&
          resource.load !== undefined
        ) {
          // Same stale-read semantics as readData: serve the stale value now,
          // revalidate in the background. A recorded refreshError blocks the
          // auto-retry until an explicit invalidate/refresh re-arms it.
          void this.startLoad(entry, resource, args, {
            lane: this.host.getLane(),
            refresh: true,
          });
        }
        return entry.value as TValue;
      }

      if (entry.status === "rejected") throwDataResourceError(entry);

      entry.ensureRetainers += 1;
      try {
        if (entry.pending !== null) {
          await entry.pending.promise;
        } else {
          await this.startLoad(entry, resource, args, {
            lane: this.host.getLane(),
            refresh: false,
          });
        }
      } finally {
        entry.ensureRetainers -= 1;
        // Hand retention back to the normal preload window so a reader
        // (the route component about to render) can still claim the entry.
        if (this.entries.get(entry.storeKey) === entry) {
          this.retainPreload(entry);
        }
      }
      // Loop and re-inspect the entry rather than trusting this load's
      // result: a superseding load, a server hydration, or an eviction may
      // have changed the authoritative state while we awaited.
    }
  }

  preloadData<TArgs extends unknown[], TValue>(
    resource: DataResource<TArgs, TValue>,
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

  readData<TArgs extends unknown[], TValue>(
    resource: DataResource<TArgs, TValue>,
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

    return this.readCurrentValue(entry);
  }

  refreshData<TArgs extends unknown[], TValue>(
    resource: DataResource<TArgs, TValue>,
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

  private entryFor<TArgs extends unknown[], TValue>(
    resource: DataResource<TArgs, TValue>,
    args: TArgs,
    create: true,
  ): { entry: Entry<Owner, Lane>; key: string };
  private entryFor<TArgs extends unknown[], TValue>(
    resource: DataResource<TArgs, TValue>,
    args: TArgs,
    create: false,
  ): { entry: Entry<Owner, Lane> | null; key: string };
  private entryFor<TArgs extends unknown[], TValue>(
    resource: DataResource<TArgs, TValue>,
    args: TArgs,
    create: boolean,
  ): { entry: Entry<Owner, Lane> | null; key: string } {
    const normalized = normalizeKey(resource.key(...args));
    // The fingerprint feeds only the dev drift diagnostics below, so
    // production never pays for encoding the args on every read.
    const fingerprint = __DEV__ ? fingerprintFor(resource, args) : null;
    const key = this.storeKey(normalized.canonical);
    const current = this.entries.get(key);

    if (current !== undefined) {
      if (__DEV__) {
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
      resource as DataResource<unknown[], unknown>,
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

  private entryForKey(key: DataResourceKey): Entry<Owner, Lane> | null {
    const normalized = normalizeKey(key);
    return this.entries.get(this.storeKey(normalized.canonical)) ?? null;
  }

  private createEntry(
    normalized: NormalizedKey,
    storeKey: string,
    resource: DataResource<unknown[], unknown> | null,
    fingerprint: string | null,
    status: FigDataEntryStatus,
    value: unknown,
  ): Entry<Owner, Lane> {
    return {
      canonicalKey: normalized.canonical,
      controller: null,
      ensureRetainers: 0,
      error: undefined,
      fingerprint,
      generation: 0,
      invalidationVersion: 0,
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
      valueController: null,
      valueErrors: new WeakSet(),
    };
  }

  private hydrateEntry(
    entry: Entry<Owner, Lane>,
    key: DataResourceKey,
    value: unknown,
  ): void {
    this.clearInactiveTimer(entry);
    this.abortEntryGenerations(entry, "superseded");
    entry.error = undefined;
    entry.generation += 1;
    // The hydrated value replaces whatever attributed hole errors the old
    // value carried; a boundary still holding one must not retire it.
    entry.valueErrors = new WeakSet();
    entry.invalidationVersion = 0;
    entry.key = key;
    entry.lane = null;
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

  private startLoad<TArgs extends unknown[], TValue>(
    entry: Entry<Owner, Lane>,
    resource: DataResource<TArgs, TValue>,
    args: TArgs,
    options: LoadOptions<Lane>,
  ): Promise<DataRefreshResult<TValue>> {
    const hadValue = entryHasValue(entry);
    const load = resource.load;

    if (this.disposed) {
      return Promise.resolve(abortedRefreshResult(entry, "store-disposed"));
    }

    if (load === undefined) {
      const error = new Error(
        `Data resource "${entry.canonicalKey}" has no loader and no hydrated value.`,
      );
      entry.error = error;
      entry.status = "rejected";
      markDataResourceError(error, entry.key);
      this.notifyEntryChange(entry);
      return Promise.resolve(unsupportedRefreshResult<TValue>(entry));
    }

    this.abortPendingLoad(entry, "superseded");
    const controller = new AbortController();
    // This generation's attributed hole errors. Allocated per load and
    // installed on the entry only at publish: attribution can fire before the
    // root value settles (a hole's error row can share a network chunk with
    // the root row), so the set must survive fulfillment, and a generation
    // that never publishes must never make the entry's live value
    // invalidatable through its own errors.
    const valueErrors = new WeakSet<object>();
    const generation = entry.generation + 1;
    const invalidationVersion = entry.invalidationVersion;
    const pending = createPendingResult<TValue>();

    entry.controller = controller;
    entry.generation = generation;
    entry.lane = options.lane;
    entry.pending = pending as PendingResult<unknown>;
    entry.status = options.refresh && hadValue ? "refreshing" : "pending";
    this.notifyEntryChange(entry);

    let loaded: TValue | PromiseLike<TValue>;
    try {
      loaded = load(
        ...args,
        this.createLoadContext(entry, controller, valueErrors),
      );
    } catch (error) {
      loaded = Promise.reject(error);
    }

    const settleAborted = (): DataRefreshResult<TValue> => {
      const result = abortedRefreshResult<TValue, Owner, Lane>(
        entry,
        "superseded",
      );
      pending.resolve(result);
      return result;
    };
    const fulfill = (value: TValue): DataRefreshResult<TValue> => {
      if (entry.generation !== generation || controller.signal.aborted) {
        return settleAborted();
      }

      const superseded = entry.valueController;
      // This generation is now the authoritative value; its controller stays
      // live for the background work still streaming into the value.
      entry.controller = null;
      entry.valueController = controller;
      entry.valueErrors = valueErrors;
      entry.error = undefined;
      entry.pending = null;
      entry.refreshError = undefined;
      entry.stale = entry.invalidationVersion !== invalidationVersion;
      entry.status = "fulfilled";
      entry.value = value;
      this.publish(entry);
      // The predecessor loses authority only now that the successor's value
      // has published: subscribers re-render top-down onto the new tree in
      // the same pass, so the old generation's retired holes unmount before
      // their abort rejections could reach a mounted reader.
      superseded?.abort();
      const result: DataRefreshResult<TValue> = { status: "fulfilled", value };
      pending.resolve(result);
      return result;
    };
    const reject = (error: unknown): DataRefreshResult<TValue> => {
      if (entry.generation !== generation || controller.signal.aborted) {
        return settleAborted();
      }

      // A rejected load's generation never becomes authoritative; abort its
      // signal so background work it started stops. The previous
      // generation's valueController is deliberately untouched: a failed
      // refresh keeps the stale value fully alive, live holes included.
      entry.controller = null;
      controller.abort();
      entry.pending = null;

      if (hadValue && entryHasValue(entry)) {
        entry.refreshError = error;
        entry.stale = true;
        entry.status = "fulfilled";
        this.publish(entry);
        const result: DataRefreshResult<TValue> = {
          error,
          staleValue: entry.value as TValue,
          status: "rejected",
        };
        pending.resolve(result);
        return result;
      }

      entry.error = error;
      entry.status = "rejected";
      markDataResourceError(error, entry.key);
      this.publish(entry);
      const result: DataRefreshResult<TValue> = { error, status: "rejected" };
      pending.resolve(result);
      return result;
    };

    if (!isThenable(loaded)) {
      fulfill(loaded);
      return pending.promise;
    }

    void Promise.resolve(loaded).then(fulfill, reject);

    return pending.promise;
  }

  private createLoadContext(
    entry: Entry<Owner, Lane>,
    controller: AbortController,
    valueErrors: WeakSet<object>,
  ): DataResourceLoadContext {
    const context: DataResourceLoadContext = { signal: controller.signal };
    defineLoadContextCapabilities(context, {
      attributeError: (error) => {
        // A fulfilled payload value may reject one of its streamed holes later.
        // Attribute that error for as long as this generation's signal is live —
        // the signal's lifetime IS its authority, so a visible value keeps
        // attributing through a superseding refresh's window. Retired decodes
        // must not make their successor invalidatable by a stale error object;
        // the errors land in this generation's own set, which reaches the entry
        // only if this generation publishes.
        if (this.disposed || controller.signal.aborted) return;
        markDataResourceError(error, entry.key);
        if (isAttributableError(error)) valueErrors.add(error);
      },
      hydrate: (entries) => {
        // Server-pushed rows hydrate for as long as this generation's signal
        // is live — the same authority window as attributeError. A visible
        // value keeps hydrating through a superseding refresh's window;
        // retired, evicted, and disposed decodes cannot mutate the store
        // (every retirement path aborts the signal).
        if (this.disposed || controller.signal.aborted) return;

        // The loading entry's own value comes from the loader's return, never
        // from a data row: hydrating its key here would supersede — and abort —
        // the very load delivering it.
        const foreign = entries.filter(
          (hydrated) =>
            this.storeKey(normalizeKey(hydrated.key).canonical) !==
            entry.storeKey,
        );
        if (__DEV__ && foreign.length !== entries.length) {
          warn(
            `Data rows targeting the loading key ${entry.canonicalKey} were skipped: a loader cannot hydrate its own entry.`,
          );
        }
        if (foreign.length > 0) this.hydrate(foreign);
      },
    });
    return context;
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

  // Aborts only the in-flight load: supersession-at-start cancels a wasted
  // request without revoking the authoritative generation's signal.
  private abortPendingLoad(
    entry: Entry<Owner, Lane>,
    reason: AbortReason,
  ): void {
    entry.controller?.abort();
    entry.controller = null;

    const pending = entry.pending;
    if (pending === null) return;

    entry.pending = null;
    pending.resolve(abortedRefreshResult(entry, reason));
  }

  // Terminal paths (hydrate-over, eviction, disposal) end every generation:
  // the pending load and the authoritative value's background work.
  private abortEntryGenerations(
    entry: Entry<Owner, Lane>,
    reason: AbortReason,
  ): void {
    this.abortPendingLoad(entry, reason);
    entry.valueController?.abort();
    entry.valueController = null;
  }

  private retainPreload(entry: Entry<Owner, Lane>): void {
    this.clearPreloadTimer(entry);
    if (this.disposed || !Number.isFinite(this.preloadRetentionMs)) return;

    entry.preloadTimer = scheduleStoreTimer(
      () => {
        entry.preloadTimer = null;
        if (
          entry.subscribers.size === 0 &&
          entry.ensureRetainers === 0 &&
          entry.pending !== null &&
          !entryHasValue(entry)
        ) {
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
      entry.ensureRetainers > 0 ||
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
          entry.preloadTimer !== null ||
          entry.ensureRetainers > 0
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
    this.abortEntryGenerations(entry, reason);
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
      pending: entry.pending !== null,
      refreshError: entry.refreshError,
      stale: entry.stale,
      status: entry.status,
      subscriberCount: entry.subscribers.size,
      value: hasValue ? entry.value : undefined,
    };
  }

  private readCurrentValue<TValue>(entry: Entry<Owner, Lane>): TValue {
    if (entryHasValue(entry)) {
      return entry.value as TValue;
    }

    if (entry.status === "rejected") throwDataResourceError(entry);

    if (entry.pending === null) {
      throw new Error(
        `Data resource "${entry.canonicalKey}" has no pending load.`,
      );
    }

    throw entry.pending.promise;
  }

  private invalidateEntry(
    entry: Entry<Owner, Lane>,
    lane: Lane,
    attributedError?: unknown,
  ): void {
    entry.invalidationVersion += 1;
    entry.stale = true;
    // Clearing the prior refresh failure re-enables auto-refresh-on-read; an
    // explicit invalidation is a fresh "this is stale, fetch again" intent.
    entry.refreshError = undefined;
    if (
      isAttributableError(attributedError) &&
      entry.valueErrors.has(attributedError)
    ) {
      entry.valueController?.abort();
      entry.valueController = null;
      entry.valueErrors = new WeakSet();
      entry.value = undefined;
      entry.error = undefined;
      entry.status = "pending";
    } else if (entry.status === "rejected") {
      // The same intent applies to a cached rejection: without this, every
      // read rethrows the old error forever — remounting an ErrorBoundary
      // could never recover. Back to pending, so the next read loads afresh.
      entry.error = undefined;
      entry.status = "pending";
    }
    this.notifyEntryChange(entry);
    if (entry.subscribers.size === 0) return;

    this.scheduleSubscribers(entry, lane);
  }

  private invalidateEntries(
    entries: readonly Entry<Owner, Lane>[],
    attributedError?: unknown,
  ): void {
    if (entries.length === 0) return;

    const lane = this.host.getLane();
    for (const entry of entries) {
      this.invalidateEntry(entry, lane, attributedError);
    }
  }
}

function normalizeKey(key: DataResourceKey): NormalizedKey {
  if (!Array.isArray(key) || typeof key[0] !== "string") {
    throw new Error(
      "Data resource keys must be arrays starting with a string.",
    );
  }

  return {
    canonical: encodeArray(key, createEncodePath("key")),
    key,
  };
}

function canonicalKeyStartsWith(key: string, prefix: string): boolean {
  if (key === prefix) return true;

  const arrayPrefix = prefix.slice(0, -1);
  return key.startsWith(arrayPrefix) && key[arrayPrefix.length] === ",";
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

function fingerprintFor<TArgs extends unknown[], TValue>(
  resource: DataResource<TArgs, TValue>,
  args: TArgs,
): string | null {
  if (resource.debugArgs !== undefined) {
    return encodeValue(
      resource.debugArgs(...args),
      createEncodePath("debugArgs"),
    );
  }

  try {
    return encodeArray(args, createEncodePath("args"));
  } catch {
    return null;
  }
}

function diagnoseEntryDrift<
  Owner extends object,
  Lane,
  TArgs extends unknown[],
  TValue,
>(
  entry: Entry<Owner, Lane>,
  resource: DataResource<TArgs, TValue>,
  key: string,
  fingerprint: string | null,
): void {
  if (!__DEV__) return;

  if (entry.resource === null) {
    entry.resource = resource as DataResource<unknown[], unknown>;
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

function createEncodePath(root: string): EncodePath {
  return { root, segments: [] };
}

function formatEncodePath(path: EncodePath): string {
  let text = path.root;
  for (const segment of path.segments) {
    text += typeof segment === "number" ? `[${segment}]` : `.${segment}`;
  }
  return text;
}

function encodeArray(values: readonly unknown[], path: EncodePath): string {
  const parts: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    path.segments.push(index);
    parts.push(encodeValue(values[index], path));
    path.segments.pop();
  }
  return `[${parts.join(",")}]`;
}

function encodeObject(value: object, path: EncodePath): string {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(
      `Invalid data resource key value at ${formatEncodePath(path)}.`,
    );
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const parts: string[] = [];

  for (const key of keys) {
    const child = record[key];
    if (child === undefined) {
      throw new Error(
        `Invalid undefined data resource key value at ${formatEncodePath(path)}.`,
      );
    }
    path.segments.push(key);
    parts.push(`${JSON.stringify(key)}:${encodeValue(child, path)}`);
    path.segments.pop();
  }

  return `{${parts.join(",")}}`;
}

function encodeValue(value: unknown, path: EncodePath): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new Error(
          `Invalid number in data resource key at ${formatEncodePath(path)}.`,
        );
      }
      return Object.is(value, -0) ? "0" : JSON.stringify(value);
    case "object":
      if (Array.isArray(value)) return encodeArray(value, path);
      return encodeObject(value, path);
    default:
      throw new Error(
        `Invalid data resource key value at ${formatEncodePath(path)}.`,
      );
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
