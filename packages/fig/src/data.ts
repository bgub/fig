export type DataResourceKeyInput =
  | string
  | number
  | boolean
  | null
  | readonly DataResourceKeyInput[]
  | { readonly [key: string]: DataResourceKeyInput };

export type DataResourceKey = readonly [string, ...DataResourceKeyInput[]];

export interface DataResourceLoadContext {
  signal: AbortSignal;
}

export interface DataResource<
  TArgs extends unknown[] = unknown[],
  TValue = unknown,
> {
  readonly $$typeof: symbol;
  readonly debugArgs?: (...args: TArgs) => DataResourceKeyInput;
  readonly key: (...args: TArgs) => DataResourceKey;
  readonly load?: (
    ...argsAndContext: [...TArgs, DataResourceLoadContext]
  ) => TValue | PromiseLike<TValue>;
}

export type DataRefreshResult<T> =
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; error: unknown; staleValue?: T }
  | {
      status: "aborted";
      reason: "superseded" | "store-disposed" | "evicted";
      staleValue?: T;
    }
  | {
      status: "unsupported";
      reason: "no-client-loader";
      staleValue?: T;
    };

export interface FigDataHydrationEntry {
  key: DataResourceKey;
  value: unknown;
}

export type FigDataEntryStatus =
  | "pending"
  | "fulfilled"
  | "rejected"
  | "refreshing";

export interface DataStoreEntrySnapshot {
  canonicalKey: string;
  error?: unknown;
  hasValue: boolean;
  key: DataResourceKey;
  pending: boolean;
  refreshError?: unknown;
  stale: boolean;
  status: FigDataEntryStatus;
  subscriberCount: number;
  value?: unknown;
}

// The explicit, app-facing store surface (FigRoot.data, readDataStore()).
// The free functions in @bgub/fig resolve the ambient store slot, which
// is only set while Fig executes synchronously — render, event handlers, the
// synchronous prefix of actions and transitions, and effects. After an
// `await` the slot is gone, so async flows capture this handle first and call
// its methods instead.
export interface FigDataStoreHandle {
  hydrate(entries: readonly FigDataHydrationEntry[]): void;
  invalidateData<TArgs extends unknown[], TValue>(
    resource: DataResource<TArgs, TValue>,
    ...args: TArgs
  ): void;
  invalidateDataError(error: unknown): boolean;
  invalidateDataKey(key: DataResourceKey): void;
  invalidateDataPrefix(prefix: DataResourceKey): void;
  preloadData<TArgs extends unknown[], TValue>(
    resource: DataResource<TArgs, TValue>,
    ...args: TArgs
  ): void;
  refreshData<TArgs extends unknown[], TValue>(
    resource: DataResource<TArgs, TValue>,
    ...args: TArgs
  ): Promise<DataRefreshResult<TValue>>;
  run<T>(callback: () => T): T;
}

export interface FigDataStore extends FigDataStoreHandle {
  commitDataDependencies(owner: object, previousOwner: object | null): void;
  deleteDataOwner(owner: object): void;
  releaseDataOwner(owner: object): void;
  resetDataDependencies(owner: object): void;
  dispose(): void;
  inspectDataEntries(): DataStoreEntrySnapshot[];
  snapshot(): FigDataHydrationEntry[];
  // Renderer plumbing, not handle surface: args stay an array because the
  // subscribing owner trails them.
  readData<TArgs extends unknown[], TValue>(
    resource: DataResource<TArgs, TValue>,
    args: TArgs,
    owner: object,
  ): TValue;
}

// The host callbacks a renderer hands to the data-store factory. Structurally
// compatible with @bgub/fig's DataStoreHost so its createDataStore can
// register directly.
export interface FigDataStoreHost {
  getLane(): unknown;
  partition?: DataResourceKeyInput;
  schedule(owner: object, lane: unknown): void;
}

export type FigDataStoreFactory = (host: FigDataStoreHost) => FigDataStore;

const objectDataErrors = new WeakMap<object, DataResourceKey[]>();

let currentDataStore: FigDataStore | null = null;

export function resolveCurrentDataStore(
  message = "Data resource APIs require a Fig data store.",
): FigDataStore {
  if (currentDataStore === null) throw new Error(message);
  return currentDataStore;
}

export function setCurrentDataStore(
  store: FigDataStore | null,
): FigDataStore | null {
  const previousStore = currentDataStore;
  currentDataStore = store;
  return previousStore;
}

export function markDataResourceError(
  error: unknown,
  key: DataResourceKey,
): void {
  // Only object errors are attributed: the WeakMap keys them by identity, so the
  // registry is GC-safe and cannot cross-attribute. Primitive rejection values
  // would collide by value and accumulate forever in a plain Map, so a thrown
  // primitive simply carries no resource-key metadata.
  if (!isObjectKey(error)) return;

  let keys = objectDataErrors.get(error);
  if (keys === undefined) {
    keys = [];
    objectDataErrors.set(error, keys);
  }

  if (keys.some((existing) => sameDataResourceKey(existing, key))) return;

  keys.push(key);
}

export function dataResourceKeysForError(
  error: unknown,
): DataResourceKey[] | undefined {
  if (!isObjectKey(error)) return undefined;

  const keys = objectDataErrors.get(error);
  return keys === undefined || keys.length === 0 ? undefined : [...keys];
}

function sameDataResourceKey(a: DataResourceKey, b: DataResourceKey): boolean {
  return (
    a.length === b.length &&
    a.every((value, index) => Object.is(value, b[index]))
  );
}

function isObjectKey(value: unknown): value is object {
  return (
    (typeof value === "object" || typeof value === "function") && value !== null
  );
}
