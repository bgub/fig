import {
  type DataRefreshResult,
  type DataResource,
  type DataResourceKey,
  type DataResourceKeyInput,
  type DataResourceLoadContext,
  type DataResourceLoader,
  type DataResourceWatchContext,
  type DataResourceWatcher,
  type DataStoreEntrySnapshot,
  dataResourceKeysForError,
  defineLoadContextCapabilities,
  type FigDataEntryStatus,
  type FigDataHydrationEntry,
  type FigDataReads,
  type FigDataStore,
  type FigDataStoreController,
  type FigDataStoreFactory,
  type FigDataStoreHandle,
  type FigDataStoreHost,
  type FigDataStoreOptions,
  isAttributableError,
  isBrowserRequirement,
  markDataResourceError,
  resolveCurrentDataStore,
  setCurrentDataStore,
} from "./data.ts";
import { readBrowser } from "./hooks.ts";

declare const __FIG_DEV__: boolean | undefined;

/** Describes data resource options. */
export interface DataResourceOptions<TArgs extends unknown[], TValue> {
  key: (...args: TArgs) => DataResourceKey;
  debugArgs?: (...args: TArgs) => DataResourceKeyInput;
  dehydrate?: false | ((value: TValue) => unknown);
  equals?: (previous: TValue, next: TValue) => boolean;
  inactiveRetentionMs?: number;
  rehydrate?: (dehydrated: unknown, context: DataResourceLoadContext) => TValue;
  load?: DataResourceLoader<TArgs, TValue>;
  watch?: DataResourceWatcher<TArgs, TValue>;
}

/** Describes data store host. */
export interface DataStoreHost<Owner extends object, Lane> {
  getLane(): Lane;
  inactiveRetentionMs?: number;
  onEntryChange?: (entry: DataStoreEntrySnapshot) => void;
  onEntryEvict?: (entry: DataStoreEntrySnapshot) => void;
  preloadRetentionMs?: number;
  schedule(owner: Owner, lane: Lane): void;
  readonly watchSources?: boolean;
}

/** Describes data store. */
export interface DataStore<
  Owner extends object = object,
  Lane = unknown,
> extends FigDataStore {
  readonly host: DataStoreHost<Owner, Lane>;
}

interface Entry<Owner extends object, Lane> {
  canonicalKey: string;
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
  // Count of ensureData calls currently awaiting this entry's load, plus
  // dependent generations (loads and watches) that ensured it through their
  // context's `data` handle. A retainer like a subscriber or the preload
  // timer: neither may see the entry evicted-and-aborted under it.
  retainers: number;
  error: unknown;
  fingerprint: string | null;
  invalidationVersion: number;
  // The reading resource's own retention, overriding the store default.
  // Hydrated entries use the default until a resource reads them.
  inactiveRetentionMs: number | undefined;
  inactiveTimer: TimerHandle | null;
  // The reading resource's transfer rule (see DataResource.dehydrate).
  dehydrate: false | ((value: unknown) => unknown) | undefined;
  // The value arrived through hydrate() in its dehydrated form and has not
  // been revived by a resource's rehydrate yet.
  rehydratePending: boolean;
  key: DataResourceKey;
  lane: Lane | null;
  pending: PendingLoad<unknown> | null;
  preloadTimer: TimerHandle | null;
  refreshError: unknown;
  refreshFailed: boolean;
  resource: DataResource<unknown[], unknown> | null;
  stale: boolean;
  status: FigDataEntryStatus;
  subscribers: Set<Owner>;
  value: unknown;
  // The running watch generation. Independent of load generations: a watch
  // lives while the entry has committed interest, across any number of loads.
  watchController: AbortController | null;
  // The resource and args of the latest read of a watchable resource. Hydrated
  // entries have no resource until a reader names one, so a watch can only
  // start once something has read the key.
  watchSource: WatchSource | null;
  // Uncommitted read sets waiting on this entry's push-only watch: a render
  // in progress, or a Suspense boundary that took over its suspended reads.
  // Each holds the watch open until it commits (becoming a subscriber) or is
  // discarded (releaseDataReads).
  readHolds: Set<FigDataReads> | null;
}

interface WatchSource {
  args: unknown[];
  resource: DataResource<unknown[], unknown>;
}

interface PendingLoad<T> {
  controller: AbortController;
  promise: Promise<DataRefreshResult<T>>;
  resolve: (result: DataRefreshResult<T>) => void;
  // A push-only resource's first read waits on its watch instead of a loader.
  watch?: true;
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
// A watch also stops when its entry loses its last committed reader.
type WatchAbortReason = AbortReason | "released";

const DataResourceSymbol = Symbol.for("fig.data-resource");
const DataStoreFactorySymbol = Symbol.for("fig.data-store-factory");
const DataStoreControllerSymbol = Symbol.for("fig.data-store-controller");
const DEFAULT_INACTIVE_RETENTION_MS = 5 * 60 * 1000;
const DEFAULT_PRELOAD_RETENTION_MS = 30 * 1000;
const __DEV__ = typeof __FIG_DEV__ === "boolean" ? __FIG_DEV__ : false;

type TimerHandle = ReturnType<typeof setTimeout>;

const dataStoreFactory: FigDataStoreFactory = createRendererDataStore;

/** Data resource. */
export function dataResource<TArgs extends unknown[], TValue>(
  options: DataResourceOptions<TArgs, TValue>,
): DataResource<TArgs, TValue> {
  const resource = {
    $$typeof: DataResourceSymbol,
    [DataStoreFactorySymbol]: dataStoreFactory,
    debugArgs: options.debugArgs,
    dehydrate: options.dehydrate,
    equals: options.equals,
    inactiveRetentionMs: options.inactiveRetentionMs,
    rehydrate: options.rehydrate,
    key: options.key,
    load: options.load,
    watch: options.watch,
  };
  return resource;
}

// Captures the ambient store as an explicit handle. Call it synchronously
// wherever Fig is executing — render, event handlers, actions, effects — and
// keep the reference: its methods still work after an `await`, where the
// ambient slot is gone.
/** Reads data store. */
export function readDataStore(): FigDataStoreHandle {
  return resolveCurrentDataStore(
    "readDataStore() must be called synchronously while Fig is executing — " +
      "during render, an event handler, an action, or an effect. Capture " +
      "the handle there and use it after awaits.",
  );
}

interface DataStoreControllerState {
  host: FigDataStoreHost | null;
}

/** Creates data store. */
export function createDataStore(
  options: FigDataStoreOptions = {},
): FigDataStoreController {
  const state: DataStoreControllerState = { host: null };
  const store = createRendererDataStore<object, unknown>({
    getLane: () => (state.host === null ? null : state.host.getLane()),
    schedule: (owner, lane) => state.host?.schedule(owner, lane),
    get watchSources() {
      return state.host?.watchSources === true;
    },
  });
  Object.defineProperty(store, DataStoreControllerSymbol, { value: state });
  if (options.initialData !== undefined) store.hydrate(options.initialData);
  return store;
}

/** Checks whether data store controller. */
export function isDataStoreController(
  value: unknown,
): value is FigDataStoreController {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    Object.hasOwn(value, DataStoreControllerSymbol)
  );
}

/** Attach data store. */
export function attachDataStore(
  controller: FigDataStoreController,
  host: FigDataStoreHost,
  initialData?: readonly FigDataHydrationEntry[],
): FigDataStore {
  if (initialData !== undefined) {
    throw new Error(
      "Pass initialData to createDataStore(), not the renderer, when adopting a data store.",
    );
  }
  const state = (
    controller as FigDataStoreController &
      Record<symbol, DataStoreControllerState | undefined>
  )[DataStoreControllerSymbol];
  if (state === undefined) {
    throw new Error("dataStore must be created with createDataStore().");
  }
  if (state.host !== null) {
    throw new Error("A data store can only be adopted by one Fig renderer.");
  }
  state.host = host;
  return controller as FigDataStore;
}

/** Creates renderer data store. */
export function createRendererDataStore<Owner extends object, Lane>(
  host: DataStoreHost<Owner, Lane>,
): DataStore<Owner, Lane> {
  return new DefaultDataStore(host);
}

/** Normalizes data resource key. */
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
  private readonly preloadRetentionMs: number;
  private disposed = false;
  private pendingWatchReconciles: Set<Entry<Owner, Lane>> | null = null;

  constructor(readonly host: DataStoreHost<Owner, Lane>) {
    this.inactiveRetentionMs =
      host.inactiveRetentionMs ?? DEFAULT_INACTIVE_RETENTION_MS;
    this.preloadRetentionMs =
      host.preloadRetentionMs ?? DEFAULT_PRELOAD_RETENTION_MS;
  }

  areDataDependenciesConsistent(reads: FigDataReads): boolean {
    for (const [key, snapshot] of reads) {
      if (snapshot === undefined) continue;
      const entry = this.entries.get(key);
      if (
        entry === undefined ||
        !entryHasValue(entry) ||
        !Object.is(snapshot.value, entry.value)
      )
        return false;
    }
    return true;
  }

  commitDataDependencies(
    owner: Owner,
    previousOwner: object | null,
    reads?: FigDataReads,
  ): boolean {
    // Committed subscriptions retain keys, never the speculative values.
    const nextKeys = reads === undefined ? null : new Set(reads.keys());
    const ownerKeys = this.ownerKeys.get(owner) ?? null;
    const previousOwnerKeys =
      previousOwner === null
        ? null
        : (this.ownerKeys.get(previousOwner) ?? null);

    if (
      (nextKeys === null || nextKeys.size === 0) &&
      ownerKeys === null &&
      previousOwnerKeys === null
    ) {
      return true;
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
          // The committed subscription replaces the uncommitted hold.
          if (reads !== undefined) entry.readHolds?.delete(reads);
          this.notifyEntryChange(entry);
        }
      }
    }

    if (orphanCandidates !== null) {
      for (const entry of orphanCandidates) this.abortOrphanedLoad(entry);
    }
    if (nextKeys !== null) {
      for (const key of nextKeys) {
        const entry = this.entries.get(key);
        if (entry !== undefined) this.scheduleWatchReconcile(entry);
      }
    }
    // Cleanup and subscription callbacks can change an entry before this owner
    // subscribes. Check after installing every subscription so no notification
    // can fall between the catch-up check and subscription establishment.
    const consistent =
      reads === undefined || this.areDataDependenciesConsistent(reads);
    reads?.clear();
    return consistent;
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

  deleteDataOwner(
    owner: object,
    retainedKeys: ReadonlySet<string> | null = null,
  ): void {
    const keys = this.ownerKeys.get(owner);
    if (keys === undefined) return;

    this.ownerKeys.delete(owner);
    for (const key of keys) {
      const entry = this.entries.get(key);
      if (entry === undefined) continue;

      entry.subscribers.delete(owner as Owner);
      this.notifyEntryChange(entry);
      if (retainedKeys?.has(key) !== true) {
        this.scheduleInactiveCleanup(entry);
        this.scheduleWatchReconcile(entry);
      }
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
    if (this.entries.get(entry.canonicalKey) !== entry) return;
    if (
      isHeld(entry) ||
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

    // Disposal retires live values (closing a client empties it), but a server
    // render's getData() may run after its stream closes. Freeze each
    // transferable form first, so a later snapshot sees the last live state.
    for (const entry of this.entries.values()) {
      if (typeof entry.dehydrate !== "function") continue;
      const dehydrated = dehydrateEntry(entry);
      if (dehydrated === undefined) continue;
      entry.value = dehydrated.value;
      entry.dehydrate = undefined;
      entry.rehydratePending = true;
    }

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
      // Retiring an earlier entry can dispose the store through an abort listener.
      if (this.disposed) return;
      const normalized = normalizeKey(hydrated.key);
      const storeKey = normalized.canonical;
      const current = this.entries.get(storeKey);

      if (current !== undefined) {
        this.hydrateEntry(current, normalized.key, hydrated.value, true);
        continue;
      }

      const entry = this.createEntry(
        normalized,
        null,
        null,
        "fulfilled",
        hydrated.value,
      );
      entry.rehydratePending = true;
      this.entries.set(storeKey, entry);
      this.notifyEntryChange(entry);
    }
  }

  snapshot(): FigDataHydrationEntry[] {
    const entries: FigDataHydrationEntry[] = [];

    for (const entry of this.entries.values()) {
      const dehydrated = dehydrateEntry(entry);
      if (dehydrated !== undefined) entries.push(dehydrated);
    }

    return entries;
  }

  dehydrateEntry(canonicalKey: string): FigDataHydrationEntry | undefined {
    const entry = this.entries.get(canonicalKey);
    return entry === undefined ? undefined : dehydrateEntry(entry);
  }

  // A resource names the transfer rules for its entries, including entries
  // first created by hydration, which only meet their resource on first read.
  private adoptTransferRules<TArgs extends unknown[], TValue>(
    entry: Entry<Owner, Lane>,
    resource: DataResource<TArgs, TValue>,
  ): void {
    if (resource.dehydrate !== undefined)
      entry.dehydrate = resource.dehydrate as Entry<Owner, Lane>["dehydrate"];
    if (!entry.rehydratePending || resource.rehydrate === undefined) return;
    entry.rehydratePending = false;
    if (!entryHasValue(entry) || this.disposed) return;
    // The revived value is its own generation: its signal retires with the
    // entry like a loaded value's, so a revived connection is closed on
    // eviction or disposal.
    const controller = new AbortController();
    const previous = entry.valueController;
    entry.value = resource.rehydrate(entry.value, {
      data: this.dependentHandle(controller.signal),
      signal: controller.signal,
    });
    entry.valueController = controller;
    previous?.abort("superseded");
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

    const entry = this.entryFor(resource, args, false);
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

  ensureData<TArgs extends unknown[], TValue>(
    resource: DataResource<TArgs, TValue>,
    ...args: TArgs
  ): Promise<TValue> {
    return this.ensureDataUntil(resource, args, undefined);
  }

  // `until` scopes one caller's wait: when it aborts, that caller stops
  // waiting and releases its retainer. The load or watch it waited on keeps
  // running for any other caller or reader.
  private async ensureDataUntil<TArgs extends unknown[], TValue>(
    resource: DataResource<TArgs, TValue>,
    args: TArgs,
    until: AbortSignal | undefined,
  ): Promise<TValue> {
    for (;;) {
      if (until?.aborted === true) throw until.reason;
      if (this.disposed) {
        throw new Error(
          "ensureData() requires a live data store; this store was disposed.",
        );
      }

      const entry = this.entryFor(resource, args, true);
      this.clearInactiveTimer(entry);
      this.retainPreload(entry);

      if (entryHasValue(entry)) {
        this.revalidateIfStale(entry, resource, args);
        return entry.value as TValue;
      }

      if (entry.status === "rejected") throwDataResourceError(entry);

      entry.retainers += 1;
      try {
        this.recordWatchSource(entry, resource, args);
        let settled: Promise<unknown>;
        if (entry.pending !== null) {
          settled = entry.pending.promise;
        } else if (this.waitsOnWatch(resource)) {
          settled = this.beginWatchPending(entry).promise;
        } else {
          settled = this.startLoad(entry, resource, args, {
            lane: this.host.getLane(),
            refresh: false,
          });
        }
        await (until === undefined ? settled : untilAborted(settled, until));
      } finally {
        entry.retainers -= 1;
        // Hand retention back to the normal preload window so a reader
        // (the route component about to render) can still claim the entry.
        if (this.entries.get(entry.canonicalKey) === entry) {
          this.retainPreload(entry);
          this.scheduleWatchReconcile(entry);
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

    const entry = this.entryFor(resource, args, true);
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
    reads?: FigDataReads,
  ): TValue {
    const entry = this.entryFor(resource, args, true);
    this.clearInactiveTimer(entry);
    this.clearPreloadTimer(entry);
    // A read that throws still establishes a dependency, but has no snapshot.
    if (reads !== undefined && !reads.has(entry.canonicalKey))
      reads.set(entry.canonicalKey, undefined);
    this.recordWatchSource(entry, resource, args);
    this.revalidateIfStale(entry, resource, args);

    if (entry.status === "pending" && entry.pending === null) {
      if (this.waitsOnWatch(resource)) {
        this.beginWatchPending(entry);
      } else {
        void this.startLoad(entry, resource, args, {
          lane: this.host.getLane(),
          refresh: false,
        });
      }
    }

    if (reads !== undefined && entry.pending?.watch === true)
      this.addReadHold(entry, reads);
    const value = this.readCurrentValue<TValue>(entry);
    // Retain the first successful read, even if a later read changes or throws.
    if (reads !== undefined && reads.get(entry.canonicalKey) === undefined)
      reads.set(entry.canonicalKey, { value });
    return value;
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
      const entry = this.entryFor(resource, args, false);
      if (entry === null) {
        return Promise.resolve(unsupportedRefreshResult<TValue>());
      }

      this.clearInactiveTimer(entry);
      return Promise.resolve(unsupportedRefreshResult<TValue>(entry));
    }

    const entry = this.entryFor(resource, args, true);
    this.clearInactiveTimer(entry);

    if (entry.pending !== null && entry.status !== "refreshing") {
      return entry.pending.promise as Promise<DataRefreshResult<TValue>>;
    }

    return this.startLoad(entry, resource, args, {
      lane: this.host.getLane(),
      refresh: entry.status === "fulfilled" || entry.status === "refreshing",
    });
  }

  run<T>(callback: () => T): T {
    const previousStore = setCurrentDataStore(this);
    try {
      return callback();
    } finally {
      setCurrentDataStore(previousStore);
    }
  }

  private entryFor<TArgs extends unknown[], TValue>(
    resource: DataResource<TArgs, TValue>,
    args: TArgs,
    create: true,
  ): Entry<Owner, Lane>;
  private entryFor<TArgs extends unknown[], TValue>(
    resource: DataResource<TArgs, TValue>,
    args: TArgs,
    create: false,
  ): Entry<Owner, Lane> | null;
  private entryFor<TArgs extends unknown[], TValue>(
    resource: DataResource<TArgs, TValue>,
    args: TArgs,
    create: boolean,
  ): Entry<Owner, Lane> | null {
    const normalized = normalizeKey(resource.key(...args));
    // The fingerprint feeds only the dev drift diagnostics below, so
    // production never pays for encoding the args on every read.
    const fingerprint = __DEV__ ? fingerprintFor(resource, args) : null;
    const key = normalized.canonical;
    const current = this.entries.get(key);

    if (current !== undefined) {
      if (resource.inactiveRetentionMs !== undefined)
        current.inactiveRetentionMs = resource.inactiveRetentionMs;
      this.adoptTransferRules(current, resource);
      if (__DEV__) {
        diagnoseEntryDrift(
          current,
          resource,
          normalized.canonical,
          fingerprint,
        );
      }
      return current;
    }

    if (!create) return null;

    const entry = this.createEntry(
      normalized,
      resource as DataResource<unknown[], unknown>,
      fingerprint,
      "pending",
      undefined,
    );
    entry.inactiveRetentionMs = resource.inactiveRetentionMs;
    this.adoptTransferRules(entry, resource);
    // A disposed store is terminal: hand back a transient entry but never
    // register it, so post-dispose reads cannot resurrect the cache.
    if (this.disposed) return entry;

    this.entries.set(key, entry);
    this.notifyEntryChange(entry);
    return entry;
  }

  private revalidateIfStale<TArgs extends unknown[], TValue>(
    entry: Entry<Owner, Lane>,
    resource: DataResource<TArgs, TValue>,
    args: TArgs,
  ): void {
    if (
      entry.status !== "fulfilled" ||
      !entry.stale ||
      entry.pending !== null ||
      entry.refreshFailed ||
      resource.load === undefined
    ) {
      return;
    }

    // Serve the stale value and revalidate in the background. A recorded
    // refreshError blocks retries until an explicit invalidate/refresh.
    void this.startLoad(entry, resource, args, {
      lane: this.host.getLane(),
      refresh: true,
    });
  }

  private entryForKey(key: DataResourceKey): Entry<Owner, Lane> | null {
    const normalized = normalizeKey(key);
    return this.entries.get(normalized.canonical) ?? null;
  }

  private createEntry(
    normalized: NormalizedKey,
    resource: DataResource<unknown[], unknown> | null,
    fingerprint: string | null,
    status: FigDataEntryStatus,
    value: unknown,
  ): Entry<Owner, Lane> {
    return {
      canonicalKey: normalized.canonical,
      retainers: 0,
      error: undefined,
      fingerprint,
      invalidationVersion: 0,
      inactiveRetentionMs: undefined,
      inactiveTimer: null,
      dehydrate: undefined,
      rehydratePending: false,
      key: normalized.key,
      lane: null,
      pending: null,
      preloadTimer: null,
      refreshError: undefined,
      refreshFailed: false,
      resource,
      stale: false,
      status,
      subscribers: new Set(),
      value,
      valueController: null,
      valueErrors: new WeakSet(),
      readHolds: null,
      watchController: null,
      watchSource: null,
    };
  }

  private recordWatchSource<TArgs extends unknown[], TValue>(
    entry: Entry<Owner, Lane>,
    resource: DataResource<TArgs, TValue>,
    args: TArgs,
  ): void {
    if (resource.watch === undefined || entry.watchSource !== null) return;
    entry.watchSource = {
      args,
      resource: resource as DataResource<unknown[], unknown>,
    };
  }

  private waitsOnWatch<TArgs extends unknown[], TValue>(
    resource: DataResource<TArgs, TValue>,
  ): boolean {
    return (
      resource.load === undefined &&
      resource.watch !== undefined &&
      this.host.watchSources === true
    );
  }

  // A push-only read with no value suspends on a pending record that the
  // watch's first publish (or failure) settles. Whoever is waiting holds the
  // watch open: the read set of the render in progress, the Suspense boundary
  // that took that read over, or an ensureData caller. When none remain, the
  // watch stops and the value-less entry evicts.
  private beginWatchPending(entry: Entry<Owner, Lane>): PendingLoad<unknown> {
    if (entry.pending !== null) return entry.pending;
    const pending = createPendingLoad<unknown>(new AbortController());
    pending.watch = true;
    entry.pending = pending;
    entry.status = "pending";
    this.notifyEntryChange(entry);
    this.scheduleWatchReconcile(entry);
    return pending;
  }

  // The `data` handle given to a load or watch. Its ensureData retains the
  // ensured entry for as long as the calling generation lives, so a resource
  // derived from another (rows from an open database) keeps its source cached
  // while the derived value is visible or watched.
  private dependentHandle(signal: AbortSignal): FigDataStoreHandle {
    const retained = new Set<Entry<Owner, Lane>>();
    const retain = (entry: Entry<Owner, Lane>) => {
      if (signal.aborted || retained.has(entry)) return;
      retained.add(entry);
      entry.retainers += 1;
      this.clearInactiveTimer(entry);
      signal.addEventListener(
        "abort",
        () => {
          entry.retainers -= 1;
          if (this.entries.get(entry.canonicalKey) === entry) {
            this.scheduleInactiveCleanup(entry);
            this.scheduleWatchReconcile(entry);
          }
        },
        { once: true },
      );
    };
    return {
      ensureData: (resource, ...args) => {
        if (!this.disposed) {
          const entry = this.entryFor(resource, args, true);
          // A cached or hydrated entry returns at once, so acquiring the
          // hold must itself restart a push-only watch the hold now wants.
          this.recordWatchSource(entry, resource, args);
          retain(entry);
          this.scheduleWatchReconcile(entry);
        }
        return this.ensureDataUntil(resource, args, signal);
      },
      hydrate: (entries) => this.hydrate(entries),
      invalidateData: (resource, ...args) =>
        this.invalidateData(resource, ...args),
      invalidateDataError: (error) => this.invalidateDataError(error),
      invalidateDataKey: (key) => this.invalidateDataKey(key),
      invalidateDataPrefix: (prefix) => this.invalidateDataPrefix(prefix),
      preloadData: (resource, ...args) => this.preloadData(resource, ...args),
      refreshData: (resource, ...args) => this.refreshData(resource, ...args),
      run: (callback) => this.run(callback),
    };
  }

  // A new value equal to the visible one keeps that value, its identity, and
  // the generation that produced it, so streamed work inside it continues and
  // readers render nothing. It still counts as a successful update: failure
  // and staleness clear.
  private keepEqualValue(entry: Entry<Owner, Lane>, stale: boolean): void {
    entry.error = undefined;
    entry.pending = null;
    entry.refreshError = undefined;
    entry.refreshFailed = false;
    entry.stale = stale;
    entry.status = "fulfilled";
    this.notifyEntryChange(entry);
    this.scheduleInactiveCleanup(entry);
  }

  // Watches start and stop from a microtask rather than inside commit or
  // cleanup: source code never runs mid-commit, and an unsubscribe followed by
  // a resubscribe in the same turn (owner churn) keeps the running watch.
  private scheduleWatchReconcile(entry: Entry<Owner, Lane>): void {
    if (entry.watchSource === null && entry.watchController === null) return;
    if (this.pendingWatchReconciles !== null) {
      this.pendingWatchReconciles.add(entry);
      return;
    }
    const entries = new Set([entry]);
    this.pendingWatchReconciles = entries;
    queueMicrotask(() => {
      this.pendingWatchReconciles = null;
      for (const pending of entries) this.reconcileWatch(pending);
    });
  }

  private wantsWatch(entry: Entry<Owner, Lane>): boolean {
    const source = entry.watchSource;
    if (
      source === null ||
      this.disposed ||
      this.host.watchSources !== true ||
      this.entries.get(entry.canonicalKey) !== entry
    ) {
      return false;
    }
    if (entry.subscribers.size > 0) return true;
    // A push-only entry's watch is also its read: anything holding the entry
    // (an uncommitted read, an awaiting caller, a dependent) holds it open.
    return source.resource.load === undefined && isHeld(entry);
  }

  private reconcileWatch(entry: Entry<Owner, Lane>): void {
    const wanted = this.wantsWatch(entry);
    if (wanted && entry.watchController === null) this.startWatch(entry);
    else if (!wanted && entry.watchController !== null)
      this.stopWatch(entry, "released");
    // Nobody is waiting for a value that only this watch could deliver.
    if (!wanted && entry.pending?.watch === true && !isHeld(entry)) {
      this.evictEntry(entry, "evicted");
    }
  }

  private addReadHold(entry: Entry<Owner, Lane>, reads: FigDataReads): void {
    (entry.readHolds ??= new Set()).add(reads);
  }

  holdDataRead(reads: FigDataReads, canonicalKey: string): void {
    if (!reads.has(canonicalKey)) reads.set(canonicalKey, undefined);
    const entry = this.entries.get(canonicalKey);
    if (entry?.pending?.watch === true) this.addReadHold(entry, reads);
  }

  releaseDataReads(reads: FigDataReads): void {
    for (const key of reads.keys()) {
      const entry = this.entries.get(key);
      if (entry?.readHolds?.delete(reads) === true) {
        this.scheduleInactiveCleanup(entry);
        this.scheduleWatchReconcile(entry);
      }
    }
  }

  private startWatch(entry: Entry<Owner, Lane>): void {
    const source = entry.watchSource;
    const watch = source?.resource.watch;
    if (source === null || watch === undefined) return;

    const controller = new AbortController();
    entry.watchController = controller;
    this.notifyEntryChange(entry);
    const context = this.createWatchContext(entry, source, controller);
    try {
      watch(...source.args, context);
    } catch (error) {
      context.fail(error);
    }
  }

  private stopWatch(entry: Entry<Owner, Lane>, reason: WatchAbortReason): void {
    const controller = entry.watchController;
    if (controller === null) return;
    entry.watchController = null;
    // Nothing keeps the value current any more; the next read revalidates.
    if (reason === "released" && entryHasValue(entry)) entry.stale = true;
    this.notifyEntryChange(entry);
    controller.abort(reason);
  }

  private createWatchContext(
    entry: Entry<Owner, Lane>,
    source: WatchSource,
    controller: AbortController,
  ): DataResourceWatchContext<unknown> {
    const live = () =>
      !this.disposed &&
      !controller.signal.aborted &&
      this.entries.get(entry.canonicalKey) === entry;

    const data = this.dependentHandle(controller.signal);
    return {
      data,
      signal: controller.signal,
      publish: (value) => {
        if (!live()) return;
        const equals = source.resource.equals ?? Object.is;
        if (entryHasValue(entry) && equals(entry.value, value)) {
          // Like any publish, this supersedes an in-flight refresh, but the
          // visible generation stays authoritative.
          const pending = entry.pending;
          entry.invalidationVersion = 0;
          entry.lane = null;
          this.keepEqualValue(entry, false);
          pending?.resolve(abortedRefreshResult(entry, "superseded"));
          pending?.controller.abort("superseded");
          return;
        }
        this.hydrateEntry(entry, entry.key, value);
        this.scheduleWatchReconcile(entry);
      },
      fail: (error) => {
        if (!live()) return;
        this.failWatchedEntry(entry, error);
      },
      refresh: () => {
        if (live()) return this.refreshData(source.resource, ...source.args);
        const reason: AbortReason | "released" = this.disposed
          ? "store-disposed"
          : controller.signal.reason === "released"
            ? "released"
            : "evicted";
        return Promise.resolve(abortedRefreshResult(entry, reason));
      },
      invalidate: () => {
        if (!live()) return;
        this.invalidateEntry(entry, this.host.getLane());
      },
    };
  }

  private failWatchedEntry(entry: Entry<Owner, Lane>, error: unknown): void {
    if (entryHasValue(entry)) {
      // Same as a failed refresh: the value stays visible and reads do not
      // retry on their own.
      entry.refreshError = error;
      entry.refreshFailed = true;
      entry.stale = true;
      this.publish(entry);
      return;
    }

    const pending = entry.pending;
    entry.pending = null;
    entry.error = error;
    entry.status = "rejected";
    markDataResourceError(error, entry.key);
    pending?.resolve({ error, status: "rejected" });
    this.publish(entry);
    pending?.controller.abort(error);
  }

  private hydrateEntry(
    entry: Entry<Owner, Lane>,
    key: DataResourceKey,
    value: unknown,
    dehydrated = false,
  ): void {
    this.clearInactiveTimer(entry);
    const valueController = entry.valueController;
    const pending = entry.pending;
    entry.valueController = null;
    entry.pending = null;
    entry.error = undefined;
    // The hydrated value replaces whatever attributed hole errors the old
    // value carried; a boundary still holding one must not retire it.
    entry.valueErrors = new WeakSet();
    entry.invalidationVersion = 0;
    entry.key = key;
    entry.lane = null;
    entry.refreshError = undefined;
    entry.refreshFailed = false;
    entry.stale = false;
    entry.status = "fulfilled";
    entry.value = value;
    entry.rehydratePending = dehydrated;
    pending?.resolve(abortedRefreshResult(entry, "superseded"));
    this.publish(entry);
    // Abort listeners may synchronously refresh this key. Publish the hydrated
    // generation first, and never overwrite a successor after calling them.
    pending?.controller.abort("superseded");
    valueController?.abort("superseded");
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

    const previousPending = entry.pending;
    const controller = new AbortController();
    // This generation's attributed hole errors. Allocated per load and
    // installed on the entry only at publish: attribution can fire before the
    // root value settles (a hole's error row can share a network chunk with
    // the root row), so the set must survive fulfillment, and a generation
    // that never publishes must never make the entry's live value
    // invalidatable through its own errors.
    const valueErrors = new WeakSet<object>();
    const invalidationVersion = entry.invalidationVersion;
    const pending = createPendingLoad<TValue>(controller);

    entry.lane = options.lane;
    entry.pending = pending as PendingLoad<unknown>;
    entry.status = options.refresh && hadValue ? "refreshing" : "pending";
    // Install the successor before retiring its predecessor: an abort listener
    // can start a newer refresh or dispose the store synchronously.
    previousPending?.resolve(abortedRefreshResult(entry, "superseded"));
    previousPending?.controller.abort("superseded");
    this.notifyEntryChange(entry);
    if (controller.signal.aborted) return pending.promise;

    let loaded: TValue | PromiseLike<TValue>;
    let browserRequirement: unknown;
    try {
      loaded = load(
        ...args,
        this.createLoadContext(entry, controller, valueErrors),
      );
    } catch (error) {
      if (isBrowserRequirement(error)) browserRequirement = error;
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
      if (entry.pending !== pending || controller.signal.aborted) {
        return settleAborted();
      }

      const equals = resource.equals ?? Object.is;
      if (entryHasValue(entry) && equals(entry.value as TValue, value)) {
        // An equal reload keeps the visible value, its identity, and the
        // generation that produced it; readers have nothing to re-render. The
        // new generation's value is discarded, so its background work stops.
        this.keepEqualValue(
          entry,
          entry.invalidationVersion !== invalidationVersion,
        );
        const result: DataRefreshResult<TValue> = {
          status: "fulfilled",
          value: entry.value as TValue,
        };
        pending.resolve(result);
        controller.abort("superseded");
        return result;
      }

      const superseded = entry.valueController;
      // This generation is now the authoritative value; its controller stays
      // live for the background work still streaming into the value.
      entry.valueController = controller;
      entry.valueErrors = valueErrors;
      entry.error = undefined;
      entry.pending = null;
      entry.refreshError = undefined;
      entry.refreshFailed = false;
      entry.stale = entry.invalidationVersion !== invalidationVersion;
      entry.status = "fulfilled";
      entry.value = value;
      const result: DataRefreshResult<TValue> = { status: "fulfilled", value };
      pending.resolve(result);
      this.publish(entry);
      // The predecessor loses authority only now that the successor's value
      // has published: subscribers re-render top-down onto the new tree in
      // the same pass, so the old generation's retired holes unmount before
      // their abort rejections could reach a mounted reader.
      superseded?.abort("superseded");
      return result;
    };
    const reject = (error: unknown): DataRefreshResult<TValue> => {
      if (entry.pending !== pending || controller.signal.aborted) {
        return settleAborted();
      }

      // A rejected load's generation never becomes authoritative; abort its
      // signal so background work it started stops. The previous
      // generation's valueController is deliberately untouched: a failed
      // refresh keeps the stale value fully alive, live holes included.
      entry.pending = null;

      if (hadValue && entryHasValue(entry)) {
        entry.refreshError = error;
        entry.refreshFailed = true;
        entry.stale = true;
        entry.status = "fulfilled";
        const result: DataRefreshResult<TValue> = {
          error,
          staleValue: entry.value as TValue,
          status: "rejected",
        };
        pending.resolve(result);
        this.publish(entry);
        controller.abort(error);
        return result;
      }

      entry.error = error;
      entry.status = "rejected";
      markDataResourceError(error, entry.key);
      const result: DataRefreshResult<TValue> = { error, status: "rejected" };
      pending.resolve(result);
      this.publish(entry);
      controller.abort(error);
      return result;
    };

    // A load that requires the browser before doing any work settles at once,
    // so a server render leaves its boundary for the browser in the shell
    // instead of streaming that decision later.
    if (browserRequirement !== undefined) {
      void (loaded as Promise<TValue>).catch(() => undefined);
      reject(browserRequirement);
      return pending.promise;
    }

    let thenable: boolean;
    try {
      thenable = isThenable(loaded);
    } catch (error) {
      // Accessing a thenable's `then` property can itself fail.
      reject(error);
      return pending.promise;
    }

    if (thenable) {
      void Promise.resolve(loaded).then(fulfill, reject);
    } else {
      fulfill(loaded as TValue);
    }
    return pending.promise;
  }

  private createLoadContext(
    entry: Entry<Owner, Lane>,
    controller: AbortController,
    valueErrors: WeakSet<object>,
  ): DataResourceLoadContext {
    const context: DataResourceLoadContext = {
      data: this.dependentHandle(controller.signal),
      signal: controller.signal,
    };
    defineLoadContextCapabilities(context, {
      key: entry.key,
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
            normalizeKey(hydrated.key).canonical !== entry.canonicalKey,
        );
        if (__DEV__ && foreign.length !== entries.length) {
          warn(
            `Data rows targeting the loading key ${entry.canonicalKey} were skipped: a loader cannot hydrate its own entry.`,
          );
        }
        for (const hydrated of foreign) {
          // Replacing an entry invokes its abort listeners synchronously. A
          // listener can retire this generation before the next row is applied.
          if (controller.signal.aborted) return;
          this.hydrate([hydrated]);
        }
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

  // Terminal paths end every captured generation. Detach all of them before
  // invoking abort listeners so reentrant work cannot be cleared or aborted.
  private abortEntryGenerations(
    entry: Entry<Owner, Lane>,
    reason: AbortReason,
  ): void {
    const valueController = entry.valueController;
    const pending = entry.pending;
    entry.valueController = null;
    entry.pending = null;
    pending?.resolve(abortedRefreshResult(entry, reason));
    pending?.controller.abort(reason);
    valueController?.abort(reason);
    this.stopWatch(entry, reason);
  }

  private retainPreload(entry: Entry<Owner, Lane>): void {
    this.clearPreloadTimer(entry);
    if (this.disposed || !Number.isFinite(this.preloadRetentionMs)) return;

    entry.preloadTimer = scheduleStoreTimer(
      () => {
        entry.preloadTimer = null;
        if (!isHeld(entry) && entry.pending !== null && !entryHasValue(entry)) {
          this.evictEntry(entry, "evicted");
          return;
        }
        this.scheduleInactiveCleanup(entry);
      },
      Math.max(0, this.preloadRetentionMs),
    );
  }

  private scheduleInactiveCleanup(entry: Entry<Owner, Lane>): void {
    const retention = entry.inactiveRetentionMs ?? this.inactiveRetentionMs;
    if (
      this.disposed ||
      isHeld(entry) ||
      entry.pending !== null ||
      entry.preloadTimer !== null ||
      !Number.isFinite(retention)
    ) {
      return;
    }

    this.clearInactiveTimer(entry);
    entry.inactiveTimer = scheduleStoreTimer(
      () => {
        entry.inactiveTimer = null;
        if (
          isHeld(entry) ||
          entry.pending !== null ||
          entry.preloadTimer !== null
        ) {
          return;
        }
        this.evictEntry(entry, "evicted");
      },
      Math.max(0, retention),
    );
  }

  private evictEntry(entry: Entry<Owner, Lane>, reason: AbortReason): void {
    if (this.entries.get(entry.canonicalKey) !== entry) return;

    this.clearInactiveTimer(entry);
    this.clearPreloadTimer(entry);
    this.entries.delete(entry.canonicalKey);
    this.abortEntryGenerations(entry, reason);
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
      ...(entry.watchController === null ? {} : { watching: true }),
    };
  }

  private readCurrentValue<TValue>(entry: Entry<Owner, Lane>): TValue {
    if (entryHasValue(entry)) {
      return entry.value as TValue;
    }

    if (entry.status === "rejected") {
      // A load that needs the browser leaves this read's Suspense boundary for
      // the browser during server rendering. In a browser render, readBrowser
      // is a no-op and the requirement surfaces as an ordinary error.
      if (isBrowserRequirement(entry.error)) readBrowser(entry.error.reason);
      throwDataResourceError(entry);
    }

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
    entry.refreshFailed = false;
    let retiredController: AbortController | null = null;
    if (
      isAttributableError(attributedError) &&
      entry.valueErrors.has(attributedError)
    ) {
      retiredController = entry.valueController;
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
    this.scheduleSubscribers(entry, lane);
    retiredController?.abort(attributedError);
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

// Every kind of ownership that keeps an entry from eviction: committed
// readers, uncommitted reads (renders in progress and Suspense boundaries
// waiting on them), and retainers (awaiting ensureData callers and dependent
// generations). Every eviction path checks this, so a new kind of ownership
// is added here once.
function isHeld<Owner extends object, Lane>(
  entry: Entry<Owner, Lane>,
): boolean {
  return (
    entry.subscribers.size > 0 ||
    entry.retainers > 0 ||
    (entry.readHolds?.size ?? 0) > 0
  );
}

function dehydrateEntry<Owner extends object, Lane>(
  entry: Entry<Owner, Lane>,
): FigDataHydrationEntry | undefined {
  if (!entryHasValue(entry) || entry.dehydrate === false) return undefined;
  // A value still in its hydrated form is already dehydrated.
  const value =
    entry.dehydrate === undefined || entry.rehydratePending
      ? entry.value
      : entry.dehydrate(entry.value);
  return { key: entry.key, value };
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
  reason: AbortReason | "released",
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
    "then" in value &&
    typeof value.then === "function"
  );
}

// Settles with `promise`, or rejects with the signal's reason as soon as it
// aborts. The underlying work is not cancelled; only this wait ends.
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

function createPendingLoad<T>(controller: AbortController): PendingLoad<T> {
  let resolve: (result: DataRefreshResult<T>) => void = () => undefined;
  const promise = new Promise<DataRefreshResult<T>>((settle) => {
    resolve = settle;
  });

  return {
    controller,
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

/** Runs with data store. */
export function runWithDataStore<T>(store: FigDataStore, callback: () => T): T {
  return store.run(callback);
}

/** Current data store. */
export function currentDataStore(): FigDataStore {
  return resolveCurrentDataStore();
}
