import type {
  DataRefreshResult,
  DataResource,
  DataResourceKey,
  FigDataHydrationEntry,
} from "@bgub/fig";
import {
  DEFAULT_INACTIVE_RETENTION_MS,
  type FigDataReads,
  type FigDataStore,
  type FigDataStoreFactory,
  type FigDataStoreHost,
  setCurrentDataStore,
  scheduleStoreTimer,
} from "@bgub/fig/internal";

// Renderer bundles do not import @bgub/fig. Resources created by that package
// carry the store factory on this symbol, so a root can buffer hydration data
// until the first real data-resource operation installs the implementation.
const DataStoreFactorySymbol = Symbol.for("fig.data-store-factory");

export function createRootDataStore(host: FigDataStoreHost): FigDataStore {
  let inner: FigDataStore | null = null;
  const buffered = new Map<
    readonly FigDataHydrationEntry[],
    ReturnType<typeof setTimeout> | null
  >();
  let disposed = false;
  let hydrationRetained = false;

  function scheduleBatchCleanup(
    entries: readonly FigDataHydrationEntry[],
  ): void {
    const timer = buffered.get(entries);
    if (timer != null) clearTimeout(timer);
    buffered.set(
      entries,
      hydrationRetained
        ? null
        : scheduleStoreTimer(() => {
            buffered.delete(entries);
          }, DEFAULT_INACTIVE_RETENTION_MS),
    );
  }

  function clearBuffer(): void {
    for (const timer of buffered.values()) {
      if (timer !== null) clearTimeout(timer);
    }
    buffered.clear();
  }

  function installStore<TArgs extends unknown[], TValue>(
    resource: DataResource<TArgs, TValue>,
  ): FigDataStore {
    if (inner !== null) return inner;
    if (disposed) {
      throw new Error("Data resource APIs require a live Fig root.");
    }

    const factory = (
      resource as DataResource & Record<symbol, FigDataStoreFactory>
    )[DataStoreFactorySymbol];
    if (factory === undefined) {
      throw new Error("Data resource APIs require @bgub/fig.");
    }

    inner = factory(host);
    inner.setHydrationRetention(hydrationRetained);
    for (const entries of buffered.keys()) inner.hydrate(entries);
    clearBuffer();
    return inner;
  }

  const store: FigDataStore = {
    retainData(resource, args, signal): void {
      if (!disposed && !signal.aborted) {
        installStore(resource).retainData(resource, args, signal);
      }
    },
    setHydrationRetention(retained: boolean): void {
      if (hydrationRetained === retained) return;
      hydrationRetained = retained;
      inner?.setHydrationRetention(retained);
      for (const entries of buffered.keys()) scheduleBatchCleanup(entries);
    },
    hydrate(entries: readonly FigDataHydrationEntry[]): void {
      if (disposed || entries.length === 0) return;
      if (inner !== null) {
        inner.hydrate(entries);
        return;
      }
      scheduleBatchCleanup(entries.slice());
    },
    run<T>(callback: () => T): T {
      if (inner !== null) return inner.run(callback);

      const previousStore = setCurrentDataStore(store);
      try {
        return callback();
      } finally {
        setCurrentDataStore(previousStore);
      }
    },
    readData<TArgs extends unknown[], TValue>(
      resource: DataResource<TArgs, TValue>,
      args: TArgs,
      reads?: FigDataReads,
    ): TValue {
      return installStore(resource).readData(resource, args, reads);
    },
    preloadData<TArgs extends unknown[], TValue>(
      resource: DataResource<TArgs, TValue>,
      ...args: TArgs
    ): void {
      installStore(resource).preloadData(resource, ...args);
    },
    ensureData<TArgs extends unknown[], TValue>(
      resource: DataResource<TArgs, TValue>,
      ...args: TArgs
    ): Promise<TValue> {
      return installStore(resource).ensureData(resource, ...args);
    },
    invalidateData<TArgs extends unknown[], TValue>(
      resource: DataResource<TArgs, TValue>,
      ...args: TArgs
    ): void {
      installStore(resource).invalidateData(resource, ...args);
    },
    invalidateDataError(error: unknown): boolean {
      return inner?.invalidateDataError(error) ?? false;
    },
    invalidateDataKey(key: DataResourceKey): void {
      inner?.invalidateDataKey(key);
    },
    invalidateDataPrefix(prefix: DataResourceKey): void {
      inner?.invalidateDataPrefix(prefix);
    },
    refreshData<TArgs extends unknown[], TValue>(
      resource: DataResource<TArgs, TValue>,
      ...args: TArgs
    ): Promise<DataRefreshResult<TValue>> {
      return installStore(resource).refreshData(resource, ...args);
    },
    areDataDependenciesConsistent(reads: FigDataReads): boolean {
      return inner?.areDataDependenciesConsistent(reads) ?? true;
    },
    commitDataDependencies(
      owner: object,
      previousOwner: object | null,
      reads?: FigDataReads,
    ): boolean {
      return inner?.commitDataDependencies(owner, previousOwner, reads) ?? true;
    },
    deleteDataOwner(owner: object): void {
      inner?.deleteDataOwner(owner);
    },
    releaseDataOwner(owner: object): void {
      inner?.releaseDataOwner(owner);
    },
    dispose(): void {
      disposed = true;
      inner?.dispose();
      inner = null;
      clearBuffer();
    },
    inspectDataEntries() {
      return inner?.inspectDataEntries() ?? [];
    },
    inspectDataDependencyCanonicalKeys(owner: object) {
      return inner?.inspectDataDependencyCanonicalKeys(owner) ?? [];
    },
    snapshot() {
      return inner?.snapshot() ?? Array.from(buffered.keys()).flat();
    },
  };

  return store;
}
