# TanStack DB Adapter Sketch

Status: prototype. `packages/fig-tanstack-db` is private and unreleased; the gaps found in the sketch are closed below.

`@bgub/fig-tanstack-db` connects TanStack DB to Fig the way the Router and Start adapters connect theirs. TanStack DB owns collections, sync, persistence, query evaluation (incremental view maintenance), and optimistic transactions. Fig owns the keyed snapshot, Suspense, hydration, and when a live query is observed.

It is the "fig-db" from the [live data resources proposal](./live-data-resources.md), built on TanStack DB rather than a new engine, and it uses only the public data-resource API: `dataResource` with `load`, `watch`, and the context's `data` handle.

## Shape

```ts
import { readData } from "@bgub/fig";
import { dbClient, liveQuery } from "@bgub/fig-tanstack-db";
import { eq } from "@tanstack/db";
import { todos } from "./collections.ts";

export const openTodos = liveQuery({
  key: (listId: string) => ["open-todos", listId],
  query: (listId) => (q) =>
    q
      .from({ todo: todos })
      .where(({ todo }) => eq(todo.listId, listId))
      .where(({ todo }) => eq(todo.done, false)),
});

function OpenTodos({ listId }: { listId: string }) {
  const rows = readData(openTodos, listId); // typed from the query
  return <ul>{rows.map((todo) => <li key={todo.id}>{todo.title}</li>)}</ul>;
}

// Writes go straight to TanStack DB.
readData(dbClient).collection(todos).insert({ id, listId, title, done: false });
```

- **`dbClientResource(options?)` / `dbClient`.** A data resource holding one TanStack `DbClient` per Fig data store: one per browser root, one per server request. That matches TanStack's own model, where module-scope `collectionOptions(id, factory)` descriptors are materialized per client. The entry is retained indefinitely and the client is cleaned up when the store is disposed, through the load generation's signal. The client itself never transfers (`transfer: false`). By default no collection's rows cross either: live queries transfer their result rows, and each browser collection syncs on its own. `transferCollection(collection)` opts collections in, and their rows cross through a per-collection entry that live queries ensure. `options` supplies the client's dependencies, such as an IndexedDB handle in the browser and the worker.
- **`capabilityDependency(client, name, reason?)`.** Reads a dependency inside a collection factory and asserts its availability with `requireCapability`.
- **`liveQuery({ key, query, client? })`.** A watched data resource:
  - `load` ensures the client through `data`, evaluates the query once (`preload`), and returns the result rows. This runs for the server render, a worker render, and the first client read, so rendered rows hydrate like any other data.
  - `watch` observes the same query with TanStack's `createLiveQueryObserver` in `wholesale` mode and publishes the snapshot's result on each notification. It publishes once when it starts, to cover changes made since the rows on screen were read.
  - Results compare structurally, virtual fields included. A notification that changed nothing keeps the visible value, and so does the first publish after hydration when the browser's view matches the server's. When it differs, for example `$hasPendingWrites` after a pending write settles, readers re-render.
  - The Fig key doubles as TanStack's live-query identity (`getLiveQueryHash`), so both caches agree on what "the same query" is.
- **Result types** come from the query builder (`InferResultType<TContext>`): an array, or a row or `undefined` for `findOne`.

The first test renders a live query over a local-only collection, follows an insert and an update, and checks that a change outside the query's result renders nothing.

## Naming

`@bgub/fig-tanstack-db`, matching `@bgub/fig-tanstack-router` and `@bgub/fig-tanstack-start`. The entry is `src/db.ts` (built as `dist/db.js`), as `router.tsx` is for the router adapter. `@tanstack/db` is pinned exactly in the workspace catalog (`1.0.0-rc.1.3`), because the adapter uses TanStack's adapter-only APIs (below). Upgrades go through the adapter's tests, as Router Core upgrades do.

## Signals

TanStack Store, which the Router adapter bridges, is built on an adaptation of alien-signals. TanStack DB does not use TanStack Store. Its reactivity is its own pipeline: differential dataflow (`@tanstack/db-ivm`) maintains each live query's result incrementally, and collections emit change events. Framework adapters consume that through `LiveQueryObserver`.

So signals are not part of this adapter's contract. The bridge is the observer's subscription feeding a Fig `watch`, the same boundary the Router adapter uses (`subscribe` + `useSyncExternalStore`), now through data resources. A Fig signals package would only matter if Fig moved to fine-grained rendering, which its model deliberately does not do.

## Gaps And How They Are Closed

1. **Non-serializable entries in `getData()`.** Core resources gained one transfer option ([data.md](../concepts/data.md#transfer-rules)). The client resource sets `transfer: false`, so it stays in the store that created it: one per request on the server, and a fresh one from the browser's own load.
2. **Environment gating.** Core gained `requireCapability(condition, reason?)` for loads ([data.md](../concepts/data.md#capability-gated-loads)). A read of an entry whose load required the browser calls `readBrowser` during server rendering, so the nearest Suspense fallback is left for the browser without an `onError` report. The adapter's `capabilityDependency(client, name)` reads a `DbClient` dependency (such as an open IndexedDB handle) and asserts its availability with `requireCapability`. A collection factory uses it, so the origin server defers while a service worker, which receives the dependency, renders. This builds on `readBrowser` ([bgub/fig#33](https://github.com/bgub/fig/pull/33)).
3. **Collection state handoff.** Collection rows are opt-in through `transferCollection`, because sending them is rarely free. A browser collection that syncs on its own fetches them again anyway unless its adapter can resume from the server's position: `query-db-collection` decides from TanStack Query's cache and ignores the seed, and an IndexedDB copy usually already holds the rows. Electric's `syncMeta` does carry a resume offset. Each source collection is an entry (`[...clientKey, "collection", id]`) that a live query ensures through `data` before observing. Its value is a slot naming the client and collection. For an opted-in collection, its `transfer` is the collection's TanStack `DehydratedCollectionChunk` once it is ready, and its `accept` applies a chunk with `applyCollectionChunk`, so the rows stream after the query's reveal and seed the browser's collection whenever they arrive ([data.md](../concepts/data.md#transfer-rules)); rows the collection's own sync wrote win. Shell reads are the exception: `takeData()` still puts the rows in the document snapshot, ahead of the bootstrap.
4. **Adapter-only TanStack APIs.** `@tanstack/db` is pinned exactly in the catalog, and the existing TanStack catalog conformance test now covers this package. Upgrades fail that test until the pin, the install, and the adapter's tests agree.
5. **Two observers per query.** One observer per client and query is shared by `load` and `watch`. Each holds it for its own lifetime: a load's generation lives while its rows are on screen, so the watch attaches to the observer the load started. The last release disposes it. A test counts exactly one observer for a mounted query and its disposal on unmount.
6. **Persisted-first readiness.** `load` waits on the observer's `preload()`. TanStack DB 1.0 moved persisted-first readiness into the collection: a persisted collection's `initialRender: { strategy: 'network-first', networkTimeoutMs }` makes restored rows ready when the network is slow, so a local-first collection renders from IndexedDB without an adapter option. A failed first load or a crash (`isLoadingError`, `isCrashed`) fails the read; a sync problem after readiness keeps the rows, as TanStack's own hooks do.
7. **Row shape.** Live-query rows are plain objects whose TanStack virtual fields (`$hasPendingWrites`, `$origin`, `$key`, `$collectionId`) are ordinary values. The end-to-end test carries them through the Payload codec. On the client they describe the server's view until the watch publishes the browser's.

The end-to-end tests server-render a live query, transfer `getData()` through the Payload codec, and hydrate with no recoverable error. By default only the query's rows cross and the browser's collection supplies its own; with a collection opted in, its rows stream after the query's reveal and seed the browser's collection, whether they arrive before hydration or after the collection's entry loaded. In both, a local insert renders live. Two more tests cover a browser-only collection: deferred on the server without `onError`, and rendered where its dependency exists, as in a worker.

## Writes

Writes need no adapter API. TanStack DB already owns optimistic state: a collection write applies at once, and a failed transaction rolls back. The live query's watch publishes each change, and Fig actions compose with that directly:

```tsx
const db = readData(dbClient);
const [status, save, isSaving] = useActionState(
  async (_previous: string, todo: Todo, _signal: AbortSignal) => {
    const transaction = db.collection(todos).insert(todo);
    try {
      await transaction.when("settled");
      return "saved";
    } catch {
      return "failed"; // TanStack has already rolled the row back.
    }
  },
  "idle",
);
```

- **Optimistic rows render while the action is pending.** TanStack notifies synchronously, so a write publishes in the lane of the code that made it, exactly like a Fig state setter: in the action's transition lane before its first `await`, at ordinary priority after one. Neither waits for the action to settle.
- **Pending lasts until the transaction settles**, because the action awaits `when("settled")`. What "settled" means is the collection's `mutationFn` contract (for example, waiting for the write to sync back).
- **Abort is not undo**, as everywhere in Fig. A superseded or unmounted action stops owning the result, and its transaction still completes or rolls back on its own. An app that wants cancellation passes the action's signal to its own backend call, whose failure then rolls the write back.
- **No `useOptimistic` layer.** For data in TanStack DB, the collection's optimistic state is the overlay. This answers the open hooks question for that data, not for component-local state.

A test drives this through `useActionState`: the optimistic row while pending, a rejected write rolling back, and a superseded run whose write still lands.

Server writes and typed RPC are out of scope here; they belong with the server design.

## How The Local-First Goals Map

| Goal | Where it lives |
| --- | --- |
| IndexedDB as the source of truth | TanStack's `indexedDBCollectionOptions` (or its persistence adapters); the adapter adds nothing |
| Sync with the remote database | TanStack collection adapters (Query, Electric, offline transactions); the adapter adds nothing |
| Declaring local vs remote collections | The choice of collection options per collection |
| Live rendering from local data | `liveQuery` (this package) |
| Worker-side rendering | `load` runs in the worker against IndexedDB; Fig Data hydrates the rows; `watch` takes over after hydration. Each source collection's rows and the query's rows cross; the origin server defers browser-only collections. |
| Remote schema changed, read-only mode | App policy on top of sync status. A small adapter helper could expose collection status as a resource. |
| CRDT fields | Outside TanStack DB: a Yjs or Loro document per field, stored through a collection |

## Next Steps

1. Port Orbit's workspace from its hand-written store to TanStack's IndexedDB collection plus `liveQuery`, passing the IndexedDB handle as a `DbClient` dependency in the browser and the worker.
2. The worker-rendering milestone: render the same query in a service worker from IndexedDB, hydrate, then go live, with another tab writing in between.
