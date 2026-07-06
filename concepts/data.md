# Data Resources

Status: stable

Key-addressable async render inputs: definitions, stores, reads, and the
freshness verbs. (Asset delivery is a separate concept — see assets.md.)

## Definitions And Identity

```ts
const userResource = dataResource({
  key: (id: string) => ["user", id],
  load: async (id, { signal }) => fetchUser(id, signal),
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

`serverDataResource` can only be imported from `.server.ts(x)` files. The
`figData` transform (`@bgub/fig-vite`) is the packaging contract: browser imports of
server-file resources become key-only stubs (the browser-safe `key` survives;
the server loader is stripped). Server-file modules imported without that
transform must fail before server code enters the client bundle.

Those two loader placements — loader-backed and hydrate-only — are the only
resource kinds the store knows. There is deliberately no third "remote" kind:
see Remote Refresh Is A Framework Layer.

## Loader Inputs

Loaders receive the resource arguments followed by `{ signal }`. The data
layer does not own app/request context or dependency injection; frameworks and adapters
that need request state should close over it when defining per-request server
resources, or route remote data requests through their own endpoint code.

Exploring: remote loaders run inside the framework data endpoint, which owns
the request — so whether those loaders get an ambient per-request context
(e.g. `AsyncLocalStorage`-backed) or keep auth and services in module scope is
Fig Start's decision, not a core data contract
(`concepts/open-questions.md`).

## Remote Refresh Is A Framework Layer

"Refresh this server value directly from the browser" is deliberately not a
core data concept: an endpoint must exist to serve the refresh, and endpoints
belong to frameworks. Fig Start owns that layer with `remoteDataResource`
(from `@bgub/fig-start/server`, declared in `.server.ts(x)` files exactly like
`serverDataResource`).

On the server, a `remoteDataResource` is an ordinary server resource that Fig
Start additionally registers behind its data endpoint under a stable generated
id: `<root-relative-server-module>#<exportName>`, mirroring payload client
references — no user-authored name registry. On the client, Fig Start's
transform compiles it into a plain isomorphic `dataResource` whose loader
closes over that id and calls the framework transport with the original
arguments. The id is the wire authority, not the key, because `key(args)` is
not invertible.

The store never learns any of this: it sees an ordinary loader-backed
resource. Reads prefer hydrated values, cache misses and explicit refreshes
run the transport loader, generation guarding and abort semantics apply
unchanged, and a transport failure is a normal `rejected` refresh result with
the stale value kept.

Remote arguments must be serializable by the framework transport, and remote
resources must not rely on `debugArgs` to hide non-serializable loader inputs:
the endpoint runs `load(...args)` with the actual client-controlled arguments.
Remote loaders are public request handlers — they must authenticate,
authorize, and validate exactly like any hand-written API route, using module
scope or whatever request context the framework endpoint provides (see Loader
Inputs).

Without a framework, the same shape is a one-liner: an isomorphic
`dataResource` whose client loader fetches an endpoint the app owns.

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

Deliberately narrow — two semantics with crisp meanings, not a react-query
vocabulary: **mark stale** (invalidate; the next read reloads lazily) and
**fetch now** (refresh). The invalidate variants differ only in targeting —
by resource and args, by exact key, by attributed error, by key prefix:

- `invalidateData(resource, ...args)` — mark stale; the next read reloads
  lazily. It also clears a cached _rejection_ (back to pending) so a
  remounted `ErrorBoundary` retries afresh, and clears a stored
  `refreshError` so read-triggered revalidation re-arms.
- `invalidateDataKey(key)` — same invalidation semantics, but targets an
  exact serialized data-resource key when the resource definition/arguments
  are not available.
- `invalidateDataError(error)` — inspect Fig's data-error attribution side
  table and invalidate every exact key associated with that error. Returns
  `true` when the error carried data keys, so fallback UIs can decide whether
  a data retry button is meaningful.
- `invalidateDataPrefix(prefix)` — mark every existing entry whose structured
  key starts with `prefix` stale. Prefixes use the same key tuple format, so
  `["user"]` matches `["user", "42"]`; matching is structural, not string
  prefix matching.
- `refreshData(resource, ...args)` — fetch now. **Never rejects**; it
  resolves a result union: `fulfilled`, `rejected { error, staleValue? }`,
  `aborted { reason: "superseded" | "store-disposed" | "evicted" }`, or
  `unsupported`. A failed refresh keeps the stale value visible and records
  `refreshError` — reads do not auto-retry a persistently failing loader
  (no refresh storms); an explicit invalidate/refresh re-arms.

Loads are generation-guarded: a superseded load's settlement is inert.

Invalidating a hydrate-only entry (no client loader) marks it stale but
leaves the fulfilled value readable. It revalidates only when a server render
or payload refresh hydrates a newer value. It must not self-destruct into a
rejected "missing loader" entry just because a client invalidation targeted
it.

## Ambient Store Vs Explicit Handle

The free functions (`readData` aside) resolve an **ambient store** that is
set only while Fig executes synchronously: render, event dispatch, the
synchronous prefix of actions and transitions, and effects (which run inside
`dataStore.run`). After an `await` the slot is gone. Async flows capture the
**explicit handle** — `readDataStore()` during any synchronous window, or
`root.data` — and call the same variadic methods
(`invalidateData`/`invalidateDataKey`/`invalidateDataError`/
`invalidateDataPrefix`/`preloadData`/`refreshData`/`hydrate`/`run`) on it.

## Stores, Scopes, And SSR Handoff

Stores are per-root on the client and per-request on the server — no global
process cache. `partition` namespaces a store's keys. Server renders collect
settled entries (`getData()` on render results; `data` rows in the payload
stream); the client hydrates them via `createRoot({ initialData })` or
`root.data.hydrate(entries)`, and hydrate-only values are readable
immediately.

Hydration into a live store is a completed refresh pushed by the server:
create the entry if missing, abort any in-flight load for that key as
superseded, bump the entry generation, clear stale/error/refresh-error state,
store the incoming value, and publish subscribers. Only settled values hydrate;
a local refreshing entry's transient stale value never wins over the incoming
fresh value.

Payload navigation does not make a second data request: data read while
rendering the server route segment streams in the same payload response as
`data` rows. The framework data endpoint (Fig Start's `remoteDataResource` —
see Remote Refresh Is A Framework Layer) serves only client-side cache misses
and refreshes outside a route payload render.

## Error Attribution

Object errors thrown through `readData` are tagged (WeakMap, GC-safe) so
`ErrorInfo.dataResourceKeys` reports which keys failed — boundaries can show
targeted recovery UI. `invalidateDataError(error)` is the cache-side half of
that loop: it resets all keys attributed to the caught error, and the UI still
chooses when to reset or remount the boundary.
