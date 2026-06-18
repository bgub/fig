export type DataResourceKeyInput =
  | string
  | number
  | boolean
  | null
  | readonly DataResourceKeyInput[]
  | { readonly [key: string]: DataResourceKeyInput };

export type DataResourceKey = readonly [string, ...DataResourceKeyInput[]];

export interface DataResourceLoadContext<TStoreContext = unknown> {
  signal: AbortSignal;
  context: TStoreContext;
}

export interface FigDataResource<
  TArgs extends unknown[] = unknown[],
  TValue = unknown,
  TStoreContext = unknown,
> {
  readonly $$typeof: symbol;
  readonly clientOnly: boolean;
  readonly debugArgs?: (...args: TArgs) => DataResourceKeyInput;
  readonly key: (...args: TArgs) => DataResourceKey;
  readonly load?: (
    ...argsAndContext: [...TArgs, DataResourceLoadContext<TStoreContext>]
  ) => TValue | PromiseLike<TValue>;
  readonly name?: string;
}

export type DataRefreshResult<T> =
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; error: unknown; staleValue?: T }
  | {
      status: "aborted";
      reason: "superseded" | "store-disposed";
      staleValue?: T;
    }
  | { status: "unsupported"; reason: "no-client-loader"; staleValue?: T };

export interface FigDataHydrationEntry {
  key: DataResourceKey;
  value: unknown;
}

export type FigDataEntryStatus =
  | "pending"
  | "fulfilled"
  | "rejected"
  | "refreshing";

export interface FigDataStoreEntrySnapshot {
  canonicalKey: string;
  error?: unknown;
  hasValue: boolean;
  key: DataResourceKey;
  name?: string;
  pending: boolean;
  refreshError?: unknown;
  stale: boolean;
  status: FigDataEntryStatus;
  subscriberCount: number;
  value?: unknown;
}

export interface FigDataStoreHandle {
  hydrate(entries: readonly FigDataHydrationEntry[]): void;
  run<T>(callback: () => T): T;
}

export interface FigDataStore extends FigDataStoreHandle {
  commitDataDependencies(
    owner: object,
    previousOwner: object | null,
    keys: readonly string[] | null,
  ): void;
  deleteDataOwner(owner: object): void;
  dispose(): void;
  inspectDataEntries(): FigDataStoreEntrySnapshot[];
  snapshot(): FigDataHydrationEntry[];
  invalidateData<TArgs extends unknown[], TValue, TStoreContext>(
    resource: FigDataResource<TArgs, TValue, TStoreContext>,
    args: TArgs,
  ): void;
  preloadData<TArgs extends unknown[], TValue, TStoreContext>(
    resource: FigDataResource<TArgs, TValue, TStoreContext>,
    args: TArgs,
  ): void;
  readData<TArgs extends unknown[], TValue, TStoreContext>(
    resource: FigDataResource<TArgs, TValue, TStoreContext>,
    args: TArgs,
    owner: object,
  ): TValue;
  refreshData<TArgs extends unknown[], TValue, TStoreContext>(
    resource: FigDataResource<TArgs, TValue, TStoreContext>,
    args: TArgs,
  ): Promise<DataRefreshResult<TValue>>;
}

interface DataErrorRegistry<TKey> {
  get(key: TKey): DataResourceKey[] | undefined;
  set(key: TKey, value: DataResourceKey[]): unknown;
}

const objectDataErrors = new WeakMap<object, DataResourceKey[]>();
const primitiveDataErrors = new Map<unknown, DataResourceKey[]>();

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
  const keys = dataErrorKeys(error);
  if (keys.some((existing) => sameDataResourceKey(existing, key))) return;

  keys.push(key);
}

export function dataResourceKeysForError(
  error: unknown,
): DataResourceKey[] | undefined {
  const keys = isObjectKey(error)
    ? objectDataErrors.get(error)
    : primitiveDataErrors.get(error);

  return keys === undefined || keys.length === 0 ? undefined : [...keys];
}

function dataErrorKeys(error: unknown): DataResourceKey[] {
  if (isObjectKey(error)) {
    return getOrCreateDataErrorKeys(objectDataErrors, error);
  }

  return getOrCreateDataErrorKeys(primitiveDataErrors, error);
}

function getOrCreateDataErrorKeys<TKey>(
  registry: DataErrorRegistry<TKey>,
  key: TKey,
): DataResourceKey[] {
  let keys = registry.get(key);
  if (keys === undefined) {
    keys = [];
    registry.set(key, keys);
  }
  return keys;
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
