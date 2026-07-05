# Data Resources

Status: stable

Key-addressable async render inputs: definitions, stores, reads, and the
freshness verbs. (Asset delivery is a separate concept — see assets.md.)

## Definitions And Identity

```ts
const userResource = dataResource({
  key: (id: string) => ["user", id],
  load: async (id, { signal, context }) => fetchUser(id, signal),
});
```

**Identity is the key.** A resource has no separate id: `key` returns an
array whose required string head namespaces the definition and whose tail
distinguishes values. One identity concept means a flat store
(`Map<canonicalKey, entry>`), free hydration lookup (the client recomputes
the same key and finds the streamed entry — no id registry), and the same
value flowing through reads, mutations, and the wire.

Keys are canonically encoded with a strict encoder — no `JSON.stringify`
traps: it throws on `undefined`, non-finite numbers, and non-plain objects,
normalizes `-0`, and sorts object keys. Dev builds fingerprint key/args
drift (a `debugArgs` escape hatch exists for intentionally non-serializable
args).

Variants: `dataResource(options)` may omit `load` to declare a key-only
resource (no client loader — hydrate-only); `serverDataResource(options)`
declares a server-only loader in a `.server.ts(x)` module. Loader-backed vs
hydrate-only is the entry's refresh mode: hydrate-only entries revalidate only
through a server/payload refresh path and report
`{ status: "unsupported", reason: "no-client-loader" }` from `refreshData`.

Server-file resources may also opt into direct client refreshes with
`serverDataResource({ remote: true, ... })`:

```ts
// user.server.ts
import { serverDataResource } from "@bgub/fig-data/server";

export const userResource = serverDataResource({
  remote: true,
  key: (id: string) => ["user", id],
  load: async (id, { context }) => context.db.user.find(id),
});
```

`serverDataResource` can only be imported from `.server.ts(x)` files. `remote`
is deliberately opt-in and must be the literal `true`; omitting it keeps the
resource server-only and no direct data endpoint is generated. The Fig Start
transform turns browser imports of a remote `.server.ts(x)` export into a
`dataResource.remote(...)` stub with the same key and a stable resource id.
Reads still hit hydrated values first; on a cache miss or explicit refresh, a
root with a `dataRemoteFetch` transport can call the server resource by id.
Without that transport, remote stubs report
`{ status: "unsupported", reason: "no-remote-fetcher" }`.

## Typed Context

Loaders receive `{ signal, context }`. The context type is registered once,
app-wide, via module augmentation — no phantom generic threading:

```ts
declare global {
  namespace FigData {
    interface Register {
      context: { db: Database };
    }
  }
}
```

`RegisteredContext` then flows as the default `TStoreContext` through
`dataResource`, `DataResourceLoadContext`, and friends. The store host's
`context` value comes from root options (`dataContext`) on the client and
per-request options on the server.

## Reads

`readData(resource, ...args)` is a render-time read (dispatcher-routed, like
`readContext`/`readPromise`): it subscribes the reading fiber to the key,
starts the load if the entry is pending, throws the pending promise to
suspend, and throws the real error on rejection (so `ErrorBoundary` catches
it; the thrown promise itself always _resolves_ — rejections settle into the
entry). Dependency bookkeeping is owner-keyed and commit-aware: abandoned
render attempts and strict shadow passes reset cleanly, and unmounting
releases subscriptions (orphaned in-flight loads abort).

`preloadData` starts a load without subscribing; unclaimed preloads abort and
evict after a grace window (default 30s). Fulfilled entries with no
subscribers evict after an inactivity window (default 5 minutes).

## The Freshness Verbs

Deliberately narrow — two verbs with crisp semantics, not a react-query
vocabulary:

- `invalidateData(resource, ...args)` — mark stale; the next read reloads
  lazily. It also clears a cached _rejection_ (back to pending) so a
  remounted `ErrorBoundary` retries afresh, and clears a stored
  `refreshError` so read-triggered revalidation re-arms.
- `refreshData(resource, ...args)` — fetch now. **Never rejects**; it
  resolves a result union: `fulfilled`, `rejected { error, staleValue? }`,
  `aborted { reason: "superseded" | "store-disposed" | "evicted" }`, or
  `unsupported`. A failed refresh keeps the stale value visible and records
  `refreshError` — reads do not auto-retry a persistently failing loader
  (no refresh storms); an explicit invalidate/refresh re-arms.

Loads are generation-guarded: a superseded load's settlement is inert.

## Ambient Store Vs Explicit Handle

The free functions (`readData` aside) resolve an **ambient store** that is
set only while Fig executes synchronously: render, event dispatch, the
synchronous prefix of actions and transitions, and effects (which run inside
`dataStore.run`). After an `await` the slot is gone. Async flows capture the
**explicit handle** — `readDataStore()` during any synchronous window, or
`root.data` — and call the same variadic methods
(`invalidateData`/`preloadData`/`refreshData`/`hydrate`/`run`) on it.

## Stores, Scopes, And SSR Handoff

Stores are per-root on the client and per-request on the server — no global
process cache. `partition` namespaces a store's keys. Server renders collect
settled entries (`getData()` on render results; `data` rows in the payload
stream); the client hydrates them via `createRoot({ initialData })` or
`root.data.hydrate(entries)`, and hydrate-only values are readable
immediately. Only settled values stream (a refreshing entry's transient
stale value never wins over its incoming fresh value).

Payload navigation does not make a second data request: data read while
rendering the server route segment streams in the same payload response as
`data` rows. The direct remote-data endpoint is only for client-side cache
misses and invalidations outside a route payload render, and only for
`serverDataResource` exports that explicitly declare `remote: true`.

## Error Attribution

Object errors thrown through `readData` are tagged (WeakMap, GC-safe) so
`ErrorInfo.dataResourceKeys` reports which keys failed — boundaries can show
targeted recovery UI.
