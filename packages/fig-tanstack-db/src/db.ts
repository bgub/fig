/**
 * TanStack DB adapter for Fig: one `DbClient` per Fig data store, and live
 * queries read through `readData` as watched data resources.
 *
 * TanStack DB owns collections, sync, persistence, query evaluation, and
 * optimistic transactions. Fig owns the keyed snapshot, Suspense, hydration,
 * and when a live query is observed.
 *
 * @module
 */
import {
  type DataResource,
  type DataResourceKey,
  type DataResourceLoadContext,
  type DataResourceWatchContext,
  dataResource,
  requireBrowser,
} from "@bgub/fig";
import {
  type Context,
  createLiveQueryObserver,
  DbClient,
  type DbClientOptions,
  type DehydratedDbState,
  getLiveQueryHash,
  type InferResultType,
  type InitialQueryBuilder,
  type LiveQueryObserver,
  prepareLiveQueryValue,
  type QueryBuilder,
  resolveLiveQueryValue,
} from "@tanstack/db";

/** Describes db client resource options. */
export interface DbClientResourceOptions {
  /** Cache key for this client. Defaults to `["fig-tanstack-db:client"]`. */
  key?: DataResourceKey;
  /** Options for each `DbClient` this resource creates (one per store). */
  options?: () => DbClientOptions;
}

/**
 * Creates the resource that owns one `DbClient` per Fig data store: one per
 * browser root, one per server request. The client lives until the store is
 * disposed, then its collections are cleaned up.
 *
 * A server render transfers the client as TanStack's dehydrated collection
 * state, captured when the render's data snapshot is taken. The browser
 * revives it into a fresh client seeded with those rows, so collections that
 * already loaded on the server do not load again. Live-query results are not
 * part of that state: Fig hydrates each query's rendered rows itself.
 */
export function createDbClient(
  options: DbClientResourceOptions = {},
): DataResource<[], DbClient> {
  const key = options.key ?? defaultClientKey;
  const open = (signal: AbortSignal, state?: DehydratedDbState) => {
    const client = new DbClient(options.options?.());
    if (state !== undefined) client.hydrate(state);
    signal.addEventListener("abort", () => void client.cleanup(), {
      once: true,
    });
    return client;
  };
  return dataResource<[], DbClient>({
    key: () => key,
    // A client holds collection state and sync; it is not a cache entry to
    // drop when no component happens to read it directly.
    inactiveRetentionMs: Number.POSITIVE_INFINITY,
    load: ({ signal }) => open(signal),
    dehydrate: (client) =>
      client.dehydrate({ shouldDehydrateLiveQuery: () => false }),
    rehydrate: (state, { signal }) => open(signal, state as DehydratedDbState),
  });
}

/**
 * Reads a `DbClient` dependency that only exists in some environments, such
 * as an open IndexedDB database. Where it is missing (the origin server), the
 * load that materializes the collection defers to the browser, so a server
 * render shows the nearest Suspense fallback; where it exists (a service
 * worker, the browser), the collection loads normally.
 */
export function browserDependency<T>(
  client: DbClient,
  name: string,
  reason?: string,
): T {
  return (
    client.getDependency<T>(name) ??
    requireBrowser(reason ?? `"${name}" is only available in the browser.`)
  );
}

const defaultClientKey: DataResourceKey = ["fig-tanstack-db:client"];

/** The default client resource used when a live query names none. */
export const dbClient: DataResource<[], DbClient> = createDbClient();

/** Describes live query options. */
export interface LiveQueryOptions<
  TArgs extends unknown[],
  TContext extends Context,
> {
  /** The Fig data key. Also the TanStack live-query identity. */
  key: (...args: TArgs) => DataResourceKey;
  /** Builds the TanStack DB query for these arguments. */
  query: (...args: TArgs) => (q: InitialQueryBuilder) => QueryBuilder<TContext>;
  /** The client resource whose collections the query reads. */
  client?: DataResource<[], DbClient>;
  inactiveRetentionMs?: number;
}

/**
 * Creates a live query readable with `readData(resource, ...args)`.
 *
 * `load` evaluates the query once (server, worker, or first client read) and
 * returns its rows, so a server render's rows hydrate like any other data.
 * `watch` observes the same query while a committed reader exists and
 * publishes each new result. A result whose rows hold the same data as the
 * visible ones, virtual fields such as `$synced` included, keeps the visible
 * value: the first publish after hydration re-renders only if the browser's
 * view differs from the server's.
 */
export function liveQuery<TArgs extends unknown[], TContext extends Context>(
  options: LiveQueryOptions<TArgs, TContext>,
): DataResource<TArgs, InferResultType<TContext>> {
  type Result = InferResultType<TContext>;
  const client = options.client ?? dbClient;

  // One observer per client and query, shared by the load that produced the
  // visible rows and the watch that keeps them current. Each holds it for its
  // own lifetime (a load's generation stays alive while its rows are on
  // screen), so the watch attaches to the observer the load already started.
  const observe = (
    db: DbClient,
    args: TArgs,
    signal: AbortSignal,
  ): LiveQueryObserver<object, string | number> => {
    const prepared = prepareLiveQueryValue(options.query(...args), db);
    const queryHash = getLiveQueryHash(prepared, options.key(...args));
    const observers = sharedObservers(db);
    let shared = observers.get(queryHash);
    if (shared === undefined) {
      shared = {
        holders: 0,
        observer: createLiveQueryObserver(resolveLiveQueryValue(prepared), {
          client: db,
          // Wholesale: notifications are wake-ups and the snapshot is re-read,
          // which is exactly what a whole-value publish needs.
          mode: "wholesale",
          queryHash,
        }),
      };
      observers.set(queryHash, shared);
    }
    const held = shared;
    held.holders += 1;
    const release = () => {
      held.holders -= 1;
      if (held.holders > 0) return;
      observers.delete(queryHash);
      held.observer.dispose();
    };
    if (signal.aborted) release();
    else signal.addEventListener("abort", release, { once: true });
    return held.observer;
  };

  return dataResource<TArgs, Result>({
    key: options.key,
    inactiveRetentionMs: options.inactiveRetentionMs,
    equals: sameData,
    load: async (...argsAndContext) => {
      const [args, { data, signal }] = splitContext<
        TArgs,
        DataResourceLoadContext
      >(argsAndContext);
      const observer = observe(await data.ensureData(client), args, signal);
      // Resolves at network readiness or at a permitted persisted fallback,
      // so a local-first collection renders from IndexedDB without waiting
      // for its remote sync.
      await observer.preloadForInitialRender();
      signal.throwIfAborted();
      const error = observer.getError();
      if (error !== undefined) throw error;
      return observer.getSnapshot().data as Result;
    },
    watch: (...argsAndContext) => {
      const [args, { data, fail, publish, signal }] = splitContext<
        TArgs,
        DataResourceWatchContext<Result>
      >(argsAndContext);
      data.ensureData(client).then((db) => {
        if (signal.aborted) return;
        const observer = observe(db, args, signal);
        const publishCurrent = () => {
          const snapshot = observer.getSnapshot();
          if (snapshot.isError) fail(observer.getError());
          else if (snapshot.isReady) publish(snapshot.data as Result);
        };
        const unsubscribe = observer.subscribe(publishCurrent);
        signal.addEventListener("abort", unsubscribe, { once: true });
        // Close the gap between the rows on screen and the subscription.
        publishCurrent();
      }, fail);
    },
  });
}

interface SharedObserver {
  holders: number;
  observer: LiveQueryObserver<object, string | number>;
}

const observersByClient = new WeakMap<DbClient, Map<string, SharedObserver>>();

function sharedObservers(client: DbClient): Map<string, SharedObserver> {
  let observers = observersByClient.get(client);
  if (observers === undefined) {
    observers = new Map();
    observersByClient.set(client, observers);
  }
  return observers;
}

// Structural equality over the plain data live queries return: rows are
// plain objects whose fields are JSON-like values or Dates. Unchanged rows
// keep their identity across TanStack revisions, so the identity check ends
// most comparisons early.
function sameData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  ) {
    return false;
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1) {
      if (!sameData(a[index], b[index])) return false;
    }
    return true;
  }
  if (a instanceof Date) {
    return b instanceof Date && a.getTime() === b.getTime();
  }
  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    if (!Object.hasOwn(b, key)) return false;
    if (!sameData(a[key], b[key])) return false;
  }
  return true;
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function splitContext<TArgs extends unknown[], TContext>(
  argsAndContext: readonly unknown[],
): [TArgs, TContext] {
  return [
    argsAndContext.slice(0, -1) as TArgs,
    argsAndContext.at(-1) as TContext,
  ];
}
