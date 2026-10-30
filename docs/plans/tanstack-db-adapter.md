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

- **`createDbClient(options?)` / `dbClient`.** A data resource holding one TanStack `DbClient` per Fig data store: one per browser root, one per server request. That matches TanStack's own model, where module-scope `collectionOptions(id, factory)` descriptors are materialized per client. The entry is retained indefinitely and the client is cleaned up when the store is disposed, through the load generation's signal. A server render transfers it as TanStack's dehydrated collection state, and the browser revives a client seeded with it. `options` supplies the client's dependencies, such as an IndexedDB handle in the browser and the worker.
- **`browserDependency(client, name, reason?)`.** Reads a dependency inside a collection factory, or requires the browser where the dependency is missing.
- **`liveQuery({ key, query, client? })`.** A watched data resource:
  - `load` ensures the client through `data`, evaluates the query once (`preloadForInitialRender`), and returns the result rows. This runs for the server render, a worker render, and the first client read, so rendered rows hydrate like any other data.
  - `watch` observes the same query with TanStack's `createLiveQueryObserver` in `wholesale` mode and publishes the snapshot's result on each notification. It publishes once when it starts, to cover changes made since the rows on screen were read.
  - Results compare structurally, virtual fields included. A notification that changed nothing keeps the visible value, and so does the first publish after hydration when the browser's view matches the server's. When it differs, for example `$synced` after the browser's sync confirms a row, readers re-render.
  - The Fig key doubles as TanStack's live-query identity (`getLiveQueryHash`), so both caches agree on what "the same query" is.
- **Result types** come from the query builder (`InferResultType<TContext>`): an array, or a row or `undefined` for `findOne`.

The first test renders a live query over a local-only collection, follows an insert and an update, and checks that a change outside the query's result renders nothing.

## Naming

`@bgub/fig-tanstack-db`, matching `@bgub/fig-tanstack-router` and `@bgub/fig-tanstack-start`. The entry is `src/db.ts` (built as `dist/db.js`), as `router.tsx` is for the router adapter. `@tanstack/db` is pinned exactly in the workspace catalog (`0.15.2`), because the adapter uses TanStack's adapter-only APIs (below). Upgrades go through the adapter's tests, as Router Core upgrades do.

## Signals

TanStack Store, which the Router adapter bridges, is built on an adaptation of alien-signals. TanStack DB does not use TanStack Store. Its reactivity is its own pipeline: differential dataflow (`@tanstack/db-ivm`) maintains each live query's result incrementally, and collections emit change events. Framework adapters consume that through `LiveQueryObserver`.

So signals are not part of this adapter's contract. The bridge is the observer's subscription feeding a Fig `watch`, the same boundary the Router adapter uses (`subscribe` + `useSyncExternalStore`), now through data resources. A Fig signals package would only matter if Fig moved to fine-grained rendering, which its model deliberately does not do.

## Gaps And How They Are Closed

1. **Non-serializable entries in `getData()`.** Core resources gained transfer rules ([data.md](../concepts/data.md#transfer-rules)): `dehydrate: false` keeps an entry out of `getData()` and Payload data rows, and `dehydrate(value)` sends a serializable form. The client resource uses the second (see 3). Disposal freezes the dehydrated form first, because a server stream closes its request store, and so cleans up the client, before a late `getData()` call.
2. **Environment gating.** Core gained `requireBrowser(reason?)` for loads ([data.md](../concepts/data.md#browser-only-loads)). A read of an entry whose load required the browser calls `readBrowser` during server rendering, so the nearest Suspense fallback is left for the browser without an `onError` report. The adapter's `browserDependency(client, name)` reads a `DbClient` dependency (such as an open IndexedDB handle) or requires the browser where it is missing. A collection factory uses it, so the origin server defers while a service worker, which receives the dependency, renders. This builds on `readBrowser` ([bgub/fig#33](https://github.com/bgub/fig/pull/33)).
3. **Collection state handoff.** The client resource dehydrates to TanStack's `DbClient.dehydrate()` state, with live-query results excluded because Fig hydrates each query's rendered rows itself. It rehydrates into a fresh `DbClient` seeded with that state. Collections that loaded on the server therefore start with their rows in the browser instead of loading again. Fig owns rendered query results, and TanStack's dehydration owns collection seeding.
4. **Adapter-only TanStack APIs.** `@tanstack/db` is pinned exactly in the catalog, and the existing TanStack catalog conformance test now covers this package. Upgrades fail that test until the pin, the install, and the adapter's tests agree.
5. **Two observers per query.** One observer per client and query is shared by `load` and `watch`. Each holds it for its own lifetime: a load's generation lives while its rows are on screen, so the watch attaches to the observer the load started. The last release disposes it. A test counts exactly one observer for a mounted query and its disposal on unmount.
6. **Persisted-first readiness.** `load` waits on `preloadForInitialRender()`, which resolves at network readiness or a permitted persisted fallback. A local-first collection therefore renders from IndexedDB without waiting for remote sync.
7. **Row shape.** Live-query rows are plain objects whose TanStack virtual fields (`$synced`, `$origin`, `$key`, `$collectionId`, `$hasPendingWrites`) are ordinary values. The end-to-end test carries them through the Payload codec. On the client they describe the server's view until the watch publishes the browser's.

The end-to-end test server-renders a live query, transfers `getData()` through the Payload codec, and hydrates with no recoverable error. It then checks that the browser's collection was seeded from the server's rows and that a local insert renders live. Two more tests cover a browser-only collection: deferred on the server without `onError`, and rendered where its dependency exists, as in a worker.

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
| Worker-side rendering | `load` runs in the worker against IndexedDB; Fig Data hydrates the rows; `watch` takes over after hydration. The client's collection state and the query's rows both cross; the origin server defers browser-only collections. |
| Remote schema changed, read-only mode | App policy on top of sync status. A small adapter helper could expose collection status as a resource. |
| CRDT fields | Outside TanStack DB: a Yjs or Loro document per field, stored through a collection |

## Next Steps

1. Port Orbit's workspace from its hand-written store to TanStack's IndexedDB collection plus `liveQuery`, passing the IndexedDB handle as a `DbClient` dependency in the browser and the worker.
2. The worker-rendering milestone: render the same query in a service worker from IndexedDB, hydrate, then go live, with another tab writing in between.
