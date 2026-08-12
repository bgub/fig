/** Describes data resource key input. */
export type DataResourceKeyInput =
  | string
  | number
  | boolean
  | null
  | readonly DataResourceKeyInput[]
  | { readonly [key: string]: DataResourceKeyInput };

/** Describes data resource key. */
export type DataResourceKey = readonly [string, ...DataResourceKeyInput[]];

/** Describes data resource load context. */
export interface DataResourceLoadContext {
  signal: AbortSignal;
}

/** Describes data resource loader. */
export type DataResourceLoader<TArgs extends unknown[], TValue> = (
  ...argsAndContext: [...TArgs, DataResourceLoadContext]
) => TValue | PromiseLike<TValue>;

/** Describes data resource. */
export interface DataResource<
  TArgs extends unknown[] = unknown[],
  TValue = unknown,
> {
  readonly $$typeof: symbol;
  readonly debugArgs?: (...args: TArgs) => DataResourceKeyInput;
  readonly key: (...args: TArgs) => DataResourceKey;
  readonly load?: DataResourceLoader<TArgs, TValue>;
}

/** Describes data refresh result. */
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

/** Describes Fig data hydration entry. */
export interface FigDataHydrationEntry {
  key: DataResourceKey;
  value: unknown;
}

/** Describes Fig data entry status. */
export type FigDataEntryStatus =
  | "pending"
  | "fulfilled"
  | "rejected"
  | "refreshing";

/** Describes data store entry snapshot. */
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
/** Describes Fig data store handle. */
export interface FigDataStoreHandle {
  // The awaitable read for code outside render (route loaders, actions after
  // an await): resolve the value this key would render with — the cached
  // value when the entry has one (kicking the same background revalidation a
  // stale readData does), the in-flight load's settlement on a cache miss —
  // and reject with the error readData would throw. Does not subscribe;
  // pair with readData in the component, which claims the settled entry
  // within the preload retention window.
  ensureData<TArgs extends unknown[], TValue>(
    resource: DataResource<TArgs, TValue>,
    ...args: TArgs
  ): Promise<TValue>;
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

/**
 * A root-neutral data store. A renderer adopts it exactly once, preserving
 * entries loaded before rendering while attaching subscriber scheduling.
 */
export interface FigDataStoreController extends FigDataStoreHandle {
  dispose(): void;
  snapshot(): FigDataHydrationEntry[];
}

/** Describes Fig data store options. */
export interface FigDataStoreOptions {
  initialData?: readonly FigDataHydrationEntry[];
  partition?: DataResourceKeyInput;
}

/** Describes Fig data store. */
export interface FigDataStore extends FigDataStoreHandle {
  commitDataDependencies(owner: object, previousOwner: object | null): void;
  deleteDataOwner(owner: object): void;
  releaseDataOwner(owner: object): void;
  resetDataDependencies(owner: object): void;
  dispose(): void;
  inspectDataDependencyCanonicalKeys(owner: object): string[];
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
// compatible with @bgub/fig's DataStoreHost so its renderer store can
// register directly.
/** Describes Fig data store host. */
export interface FigDataStoreHost {
  getLane(): unknown;
  partition?: DataResourceKeyInput;
  schedule(owner: object, lane: unknown): void;
}

/** Describes Fig data store factory. */
export type FigDataStoreFactory = (host: FigDataStoreHost) => FigDataStore;

// The internal, generation-guarded metadata a store attaches to each loader
// context (symbol-keyed: DataResourceLoadContext stays { signal } publicly).
// Adapters use the resolved key and decode Payload rows through the calling
// store without recomputing identity or exposing these capabilities to loaders.
/** Describes load context hydrate. */
export type LoadContextHydrate = (
  entries: readonly FigDataHydrationEntry[],
) => void;
/** Describes load context attribute error. */
export type LoadContextAttributeError = (error: unknown) => void;

/** Describes load context capabilities. */
export interface LoadContextCapabilities {
  attributeError: LoadContextAttributeError;
  hydrate: LoadContextHydrate;
  // Store contexts always provide this; optional keeps synthetic decoder
  // contexts usable without pretending they belong to a cache entry.
  key?: DataResourceKey;
}

const LoadContextCapabilitiesSymbol = Symbol.for("fig.data-load-context");
type DataResourceLoadContextWithCapabilities = DataResourceLoadContext & {
  [LoadContextCapabilitiesSymbol]?: LoadContextCapabilities;
};

/** Define load context capabilities. */
export function defineLoadContextCapabilities(
  context: DataResourceLoadContext,
  capabilities: LoadContextCapabilities,
): void {
  Object.defineProperty(context, LoadContextCapabilitiesSymbol, {
    configurable: true,
    enumerable: false,
    value: capabilities,
  });
}

/** Load context capabilities. */
export function loadContextCapabilities(
  context: DataResourceLoadContext,
): LoadContextCapabilities | undefined {
  return (context as DataResourceLoadContextWithCapabilities)[
    LoadContextCapabilitiesSymbol
  ];
}

const objectDataErrors = new WeakMap<object, DataResourceKey[]>();

let currentDataStore: FigDataStore | null = null;

/** Resolves current data store. */
export function resolveCurrentDataStore(
  message = "Data resource APIs require a Fig data store.",
): FigDataStore {
  if (currentDataStore === null) throw new Error(message);
  return currentDataStore;
}

/** Sets current data store. */
export function setCurrentDataStore(
  store: FigDataStore | null,
): FigDataStore | null {
  const previousStore = currentDataStore;
  currentDataStore = store;
  return previousStore;
}

/** Marks data resource error. */
export function markDataResourceError(
  error: unknown,
  key: DataResourceKey,
): void {
  // Only object errors are attributed: the WeakMap keys them by identity, so the
  // registry is GC-safe and cannot cross-attribute. Primitive rejection values
  // would collide by value and accumulate forever in a plain Map, so a thrown
  // primitive simply carries no resource-key metadata.
  if (!isAttributableError(error)) return;

  let keys = objectDataErrors.get(error);
  if (keys === undefined) {
    keys = [];
    objectDataErrors.set(error, keys);
  }

  if (keys.some((existing) => sameDataResourceKey(existing, key))) return;

  keys.push(key);
}

/** Data resource keys for error. */
export function dataResourceKeysForError(
  error: unknown,
): DataResourceKey[] | undefined {
  if (!isAttributableError(error)) return undefined;

  const keys = objectDataErrors.get(error);
  return keys === undefined || keys.length === 0 ? undefined : [...keys];
}

function sameDataResourceKey(a: DataResourceKey, b: DataResourceKey): boolean {
  return (
    a.length === b.length &&
    a.every((value, index) => Object.is(value, b[index]))
  );
}

// The single rule for which errors can carry attribution: identity-keyed
// (WeakMap/WeakSet) registries require object errors. Shared with the store's
// per-generation value-error sets so the two can never disagree.
export function isAttributableError(value: unknown): value is object {
  return (
    (typeof value === "object" || typeof value === "function") && value !== null
  );
}
