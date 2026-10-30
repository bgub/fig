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
  /**
   * The store running this load. Entries ensured through it stay cached
   * while this load's value is visible.
   */
  data: FigDataStoreHandle;
  signal: AbortSignal;
}

/** Describes data resource loader. */
export type DataResourceLoader<TArgs extends unknown[], TValue> = (
  ...argsAndContext: [...TArgs, DataResourceLoadContext]
) => TValue | PromiseLike<TValue>;

/**
 * Capabilities a watch receives. Every operation is bound to the watched key
 * and becomes inert once `signal` aborts.
 */
export interface DataResourceWatchContext<TValue> {
  /**
   * The store running this watch. Entries ensured through it stay cached
   * while this watch runs.
   */
  data: FigDataStoreHandle;
  signal: AbortSignal;
  /** Replaces the entry's value, as a successful server push would. */
  publish: (value: TValue) => void;
  /** Records a failure: a visible value stays, a missing one rejects. */
  fail: (error: unknown) => void;
  /**
   * Reruns `load` for this key and resolves with the outcome (`unsupported`
   * for push-only resources; `aborted` once the watch has stopped).
   */
  refresh: () => Promise<DataRefreshResult<TValue>>;
  /** Marks this key stale. */
  invalidate: () => void;
}

/** Describes data resource watcher. */
export type DataResourceWatcher<TArgs extends unknown[], TValue> = (
  ...argsAndContext: [...TArgs, DataResourceWatchContext<TValue>]
) => void;

/** Describes data resource. */
export interface DataResource<
  TArgs extends unknown[] = unknown[],
  TValue = unknown,
> {
  readonly $$typeof: symbol;
  readonly debugArgs?: (...args: TArgs) => DataResourceKeyInput;
  // Decides whether a new value replaces the visible one. Defaults to
  // Object.is; equal values keep the current value and render nothing.
  readonly equals?: (previous: TValue, next: TValue) => boolean;
  // How long an entry with no readers or retainers stays cached before it is
  // evicted and its generation's signal aborts. Overrides the store default.
  readonly inactiveRetentionMs?: number;
  readonly key: (...args: TArgs) => DataResourceKey;
  readonly load?: DataResourceLoader<TArgs, TValue>;
  readonly watch?: DataResourceWatcher<TArgs, TValue>;
}

/** Describes data refresh result. */
export type DataRefreshResult<T> =
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; error: unknown; staleValue?: T }
  | {
      status: "aborted";
      reason: "superseded" | "store-disposed" | "evicted" | "released";
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
  /** Present and true while a watch is pushing values into this entry. */
  watching?: boolean;
}

// The explicit, app-facing store surface (FigRoot.data, readDataStore()).
// Capture readDataStore() while Fig executes synchronously, or use root.data
// or a pre-created store. Imperative operations always use these explicit
// handles and remain available after an await.
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
}

// Attempt-owned observations. A missing snapshot records a read that threw;
// wrapping successful values distinguishes a fulfilled undefined value.
export type FigDataReads = Map<string, { value: unknown } | undefined>;

/** Describes Fig data store. */
export interface FigDataStore extends FigDataStoreHandle {
  areDataDependenciesConsistent(reads: FigDataReads): boolean;
  // Installs subscriptions, consumes reads, and reports whether they still match.
  commitDataDependencies(
    owner: object,
    previousOwner: object | null,
    reads?: FigDataReads,
  ): boolean;
  deleteDataOwner(owner: object): void;
  // Adds a key to an attempt's read set as a read that has no value yet,
  // holding the key like a read made through readData. Suspense boundaries
  // use it to take over the reads their suspended content was waiting on.
  holdDataRead(reads: FigDataReads, canonicalKey: string): void;
  releaseDataOwner(owner: object): void;
  // A render attempt discarded a read set without committing it. Keys it was
  // holding open while waiting on a load or watch are released.
  releaseDataReads(reads: FigDataReads): void;
  dispose(): void;
  inspectDataDependencyCanonicalKeys(owner: object): string[];
  inspectDataEntries(): DataStoreEntrySnapshot[];
  snapshot(): FigDataHydrationEntry[];
  // Renderer plumbing, not handle surface: args stay an array because the
  // optional attempt-owned reads trail them. Server reads omit observations.
  readData<TArgs extends unknown[], TValue>(
    resource: DataResource<TArgs, TValue>,
    args: TArgs,
    reads?: FigDataReads,
  ): TValue;
}

// The host callbacks a renderer hands to the data-store factory. Structurally
// compatible with @bgub/fig's DataStoreHost so its renderer store can
// register directly.
/** Describes Fig data store host. */
export interface FigDataStoreHost {
  getLane(): unknown;
  schedule(owner: object, lane: unknown): void;
  // Client renderers set this. Server stores never start watches: a server
  // render reads a snapshot through `load` or hydrated values.
  readonly watchSources?: boolean;
}

/** Describes Fig data store factory. */
export type FigDataStoreFactory = (host: FigDataStoreHost) => FigDataStore;

// The internal, generation-guarded metadata a store attaches to each loader
// context (symbol-keyed: they stay off the public DataResourceLoadContext).
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

/** Captures an optional data store for synchronous scope re-entry. */
export function getCurrentDataStore(): FigDataStore | null {
  return currentDataStore;
}

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
