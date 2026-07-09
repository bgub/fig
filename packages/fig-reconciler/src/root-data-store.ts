import type {
  DataRefreshResult,
  DataResource,
  DataResourceKey,
  FigDataHydrationEntry,
} from "@bgub/fig";
import {
  type FigDataStore,
  type FigDataStoreFactory,
  type FigDataStoreHost,
  setCurrentDataStore,
} from "@bgub/fig/internal";

// Renderer bundles do not import @bgub/fig. Resources created by that package
// carry the store factory on this symbol, so a root can buffer hydration data
// until the first real data-resource operation installs the implementation.
const DataStoreFactorySymbol = Symbol.for("fig.data-store-factory");

export function createRootDataStore(host: FigDataStoreHost): FigDataStore {
  let inner: FigDataStore | null = null;
  let buffered: FigDataHydrationEntry[] | null = null;
  let disposed = false;

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
    if (buffered !== null) inner.hydrate(buffered);
    buffered = null;
    return inner;
  }

  const store: FigDataStore = {
    hydrate(entries: readonly FigDataHydrationEntry[]): void {
      if (inner !== null) {
        inner.hydrate(entries);
        return;
      }
      (buffered ??= []).push(...entries);
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
      owner: object,
    ): TValue {
      return installStore(resource).readData(resource, args, owner);
    },
    preloadData<TArgs extends unknown[], TValue>(
      resource: DataResource<TArgs, TValue>,
      ...args: TArgs
    ): void {
      installStore(resource).preloadData(resource, ...args);
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
    commitDataDependencies(owner: object, previousOwner: object | null): void {
      inner?.commitDataDependencies(owner, previousOwner);
    },
    deleteDataOwner(owner: object): void {
      inner?.deleteDataOwner(owner);
    },
    releaseDataOwner(owner: object): void {
      inner?.releaseDataOwner(owner);
    },
    resetDataDependencies(owner: object): void {
      inner?.resetDataDependencies(owner);
    },
    dispose(): void {
      disposed = true;
      inner?.dispose();
      inner = null;
      buffered = null;
    },
    inspectDataEntries() {
      return inner?.inspectDataEntries() ?? [];
    },
    snapshot() {
      return inner?.snapshot() ?? buffered?.slice() ?? [];
    },
  };

  return store;
}
