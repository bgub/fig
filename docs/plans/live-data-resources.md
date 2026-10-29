# Live Data Resources Proposal

Status: Part 1 (watched resources), `equals`, per-resource retention, and the `data` handle are specified in [data.md](../concepts/data.md), with reconciler ownership in [architecture.md](../concepts/architecture.md) and [rendering.md](../concepts/rendering.md). Parts 2 (`setData`) and 3 (optimistic overlays) remain proposals.

## Summary

Add one capability to Fig Data: a resource may **watch** an external source and push values into its entry while the entry is in use. Then add two smaller write primitives: an authoritative `data.setData` and a transition-scoped optimistic overlay.

```ts
const projectIssues = dataResource({
  key: (projectId: string) => ["issues", projectId],
  // Snapshot read: server render, worker render, cache miss, refresh.
  load: (projectId, { signal }) => issues.query({ projectId }, { signal }),
  // Live updates while a committed reader exists.
  watch: (projectId, { publish, signal }) => {
    issues.subscribe({ projectId }, publish, { signal });
  },
});
```

Components keep calling `readData(projectIssues, projectId)`. Nothing else changes for them.

This is the one core change that local databases, polling, focus/reconnect refetch, and sync engines all need. Everything above it — `@bgub/fig-db`, `@bgub/fig-query`, worker-side rendering — composes the existing data store instead of inventing a second reactive cache.

## Motivation

Fig Data currently has two resource kinds: loader-backed and hydrate-only. Values change only when Fig pulls them (`load`, `refreshData`) or a server pushes them (`hydrate`, Payload data rows). External stores that push changes — an IndexedDB live query, a WebSocket, a BroadcastChannel — must go through `useSyncExternalStore` instead.

Orbit shows the cost. Its workspace subscribes to the whole TanStack DB collection through `useSyncExternalStore` (`apps/orbit/src/workspace.tsx`). That loses everything Fig Data owns:

- **No Suspense on first read.** Opening IndexedDB is async, so the app hand-rolls a loading state before the store exists.
- **No SSR handoff.** `getServerSnapshot` has no transport. A server or worker render cannot hand the exact values it rendered to hydration through `getData()`.
- **No keyed cache.** Every query is a separate external store with its own lifetime, eviction, and DevTools visibility (none).
- **No refresh vocabulary.** Invalidation, refresh results, and error attribution do not apply.

Live resources keep those properties and add push updates.

The second gap is writes. Fig Data has no typed way to write a value from the client, and the open question about a lane-aware `useOptimistic` analog has no data-layer answer. Both get smaller, separable sections below.

## Goals

- Push updates into keyed entries with the same generation guarantees as loads and hydration.
- Keep one rendering contract: `readData` suspends, throws, or returns; speculative-read validation and commit-aware subscriptions are reused unchanged.
- Make worker-side and server-side rendering correct by construction: render from a snapshot, hydrate that exact snapshot, then go live.
- Let policy packages (`fig-query`, `fig-db`) express polling, focus refetch, and change feeds without reaching into store internals.

## Non-goals

- A query language, collections, persistence, or sync. Those belong to `@bgub/fig-db`.
- Retries, backoff, infinite queries, or mutation helpers. Those belong to `@bgub/fig-query`.
- A public signals primitive. Watch sources are opaque callbacks; Fig only sees published values.
- Component-local optimistic state (`useOptimistic`). That remains a separate hooks question.

## Part 1: Watched Resources

### Definition

`dataResource` gains an optional `watch`:

```ts
interface DataResourceWatchContext<TValue> {
  data: FigDataStoreHandle; // see "Store handle in load and watch"
  signal: AbortSignal;
  // Properties, not methods, so sources can destructure and pass them as
  // listeners without binding.
  publish: (value: TValue) => void;
  fail: (error: unknown) => void;
  refresh: () => Promise<DataRefreshResult<TValue>>;
  invalidate: () => void;
}

dataResource({
  key,
  load?, // existing
  watch?: (...argsAndContext: [...TArgs, DataResourceWatchContext<TValue>]) => void,
  equals?: (previous: TValue, next: TValue) => boolean, // default Object.is
  inactiveRetentionMs?: number, // default: the store's retention
});
```

Like every Fig callback, `watch` receives a signal and returns `undefined`. Returning a cleanup function is a type error.

The resource kinds become:

| `load` | `watch` | Kind | Server read | Client read |
| --- | --- | --- | --- | --- |
| yes | no | loader-backed | load | load, refresh |
| no | no | hydrate-only | hydrated only | hydrated only |
| yes | yes | live | load | load, then watch pushes |
| no | yes | push-only | hydrated only | suspends until first publish |

### Watch lifetime

A watch is a **watch generation**, separate from load generations. It starts and stops with committed interest:

- **Start:** when an entry gains its first committed subscriber (inside `commitDataDependencies`). Speculative reads, strict shadow renders, `preloadData`, and `ensureData` never start a watch of a live resource. Neither does the server.
- **Exception, push-only first reads:** a push-only resource has no `load`, so its watch is also its first read. A value-less push-only read (from render or from `ensureData`) starts the watch immediately, because a suspended reader never commits and could otherwise never resolve its own Suspense. The watch stays open exactly as long as something waits for its value, with no time limit:
  - **The render in progress.** The read is recorded in the render attempt's read set, which holds the watch. If the attempt is discarded (interrupted, restarted, rolled back by an outer boundary), the reconciler tells the store (`releaseDataReads`) and the hold ends.
  - **The Suspense boundary showing the fallback.** When the read suspends, the boundary takes over the keys its discarded content was waiting on (reads with no value) and commits them with its fallback as its own subscription. The fallback holds the watch for as long as it is on screen, however slow the source. When the content reveals, the reader subscribes and the boundary lets go in the same commit, so the watch is not restarted. If the boundary unmounts first, the value-less entry is discarded and the watch stops with `"evicted"`.
  - **`ensureData` callers and dependents** (a load or watch that ensured it through `data`) hold it through the existing retainer count.

  When none of these remain, the watch stops and the value-less entry evicts, waking any suspended reader so it can retry. A render that is discarded and restarted across tasks can therefore restart the watch once; a restart within the same task nets out, because watches start and stop a microtask later.

- **Stop:** when the entry loses its last subscriber (`deleteDataOwner`/`releaseDataOwner`), is evicted, or the store is disposed. The signal aborts with `"released"`, `"evicted"`, or `"store-disposed"`.
- **On stop:** the entry stays cached and is marked stale. Its value is no longer kept current, so the next read revalidates through `load` (or, for push-only resources, through the next watch).

Hidden Activity subscribers count as committed interest. Their watch keeps running and publishes at offscreen priority, as hidden readers already do.

Starting the watch only at commit is what makes hydration safe: hydration renders the hydrated snapshot, and live values can arrive only after that render has committed.

### Publishing

`publish(value)` behaves like a generation-guarded hydration of one entry, scoped to the watch:

- It creates or replaces the value, clears `stale`, `error`, and `refreshError`, and notifies subscribers.
- It supersedes an in-flight load: that load resolves `aborted: "superseded"`, the same as a hydration racing a load today.
- It does **not** abort the current value generation's signal unless the value actually changes. A Payload value streaming holes keeps streaming through equal publishes.
- If `equals(previous, next)` returns true, the visible value, its identity, and its generation stay, and no subscribers are scheduled. The publish still counts as a successful update: it supersedes an in-flight refresh (which resolves `aborted: "superseded"`) and clears `stale` and any refresh error a previous `fail` recorded. `equals` defaults to `Object.is`, so republishing the same reference is free. Structural comparison is opt-in; structural sharing belongs to the source.
- `equals` applies to every new value, not only publishes. A load or refresh that settles equal to the visible value keeps that value (and its identity), clears `stale` and refresh errors, resolves `refreshData` as fulfilled with the existing value, and schedules no readers. The equal load's own generation retires as `"superseded"`; the generation that produced the visible value stays authoritative, so a Payload value keeps streaming its holes.
- Priority is the ambient lane (`host.getLane()`), the same rule `hydrateEntry` uses today. A source that wraps its publish in `transition()` publishes at transition priority.
- After the watch signal aborts, `publish`, `fail`, `refresh`, and `invalidate` are inert. `refresh` then resolves `aborted` with the watch's reason (`"released"`, `"evicted"`, or `"store-disposed"`); `"released"` joins the aborted reasons of `DataRefreshResult`.

`publish` replaces the whole value. A source that delivers events or deltas ("user joined") must fold them into a snapshot before publishing. That accumulator belongs to the adapter (fig-db, a socket client), not core. Adapters also own shared connections: one socket serving many keys is opened and reference-counted by the adapter, with each key's watch registering interest.

Between render chunks, a publish is just another concurrent data change. The render attempt's read-set validation already retries instead of committing a mixed snapshot.

### Failing

`fail(error)` follows refresh-failure semantics:

- **Entry has a value:** the value stays visible, and `refreshError` is recorded. No automatic retry; a later publish, refresh, or invalidation re-arms it.
- **Entry has no value:** the entry rejects, and the next `readData` throws to the nearest ErrorBoundary.

A `watch` that throws synchronously is equivalent to `fail(thrown)`. The watch generation remains active; the source decides whether it can still publish.

### Retention

`inactiveRetentionMs` sets how long an entry with no readers, preloads, or pending `ensureData` calls stays cached before it is evicted. Eviction aborts the value generation's signal, so a resource whose value owns a connection (an open database, a socket) closes it there. It overrides the store-wide default (five minutes) for that resource's entries; `Infinity` keeps entries until the store is disposed. Hydrated entries use the store default until a resource reads them. Preload retention stays store-wide.

### `publish` or `refresh`?

Use `publish` when the source delivers the value itself: a live-query callback with current results, a WebSocket message carrying rows, a synchronous in-memory store, or any push-only resource.

Use `refresh` when the source only says that something changed: a BroadcastChannel ping from another tab, a "row updated" event, a focus or reconnect event. The notification carries no data, so the watch would only re-run `load` itself. Doing that by hand is also subtly wrong: two notifications close together start two async reads, and if the older one settles last it publishes stale rows over newer ones. `refresh` goes through the load path, where a newer load supersedes an older one and a superseded result cannot publish.

```ts
// Another tab wrote to IndexedDB: re-read through load.
watch: (projectId, { refresh, signal }) => {
  const channel = new BroadcastChannel("orbit");
  channel.addEventListener("message", refresh);
  signal.addEventListener("abort", () => channel.close(), { once: true });
  // Catch writes made before this watch started listening (see Hydration).
  refresh();
};
```

A notification-only source must also refresh once when it starts. Otherwise a write made between the server render and the watch starting sends no notification the watch can hear, and the hydrated value stays stale. With `equals`, that start-up refresh and any notification for rows this key does not show re-render nothing.

### `refresh` and `invalidate` inside watch

These are the store-handle operations, bound to the watched key and gated by the watch signal. `refresh` resolves with the same `DataRefreshResult` as `refreshData`, so a policy adapter can see failures and back off. They let policy live in sources instead of core:

```ts
// fig-query style focus/reconnect refetch: no new core API.
watch: (id, { refresh, signal }) => {
  window.addEventListener("focus", refresh, { signal });
  window.addEventListener("online", refresh, { signal });
};

// Polling.
watch: (id, { refresh, signal }) => {
  const timer = setInterval(refresh, 10_000);
  signal.addEventListener("abort", () => clearInterval(timer), { once: true });
};
```

The interaction with existing APIs stays simple:

- `refreshData` on a live entry runs `load`. The watch keeps running.
- On a push-only entry, `refreshData` reports `unsupported` with no loader.
- `invalidateData` marks the entry stale. With a running watch, the next read still serves the current value and revalidates in the background, as today.

### Hydration and SSR

Server rendering never calls `watch`. A live resource renders from `load` on the server. Its settled value appears in `getData()` and hydrates normally.

A push-only resource behaves like a hydrate-only resource on the server. Rendering it without a hydrated value is the existing "no loader and no hydrated value" error.

The client sequence is:

1. `hydrate(entries)` installs the server values.
2. Hydration renders those values. No watch has started, so no drift is possible.
3. Hydration commits, subscriptions install, and watches start.
4. Each source publishes its current value, or calls `refresh()` if it is notification-only. If the value differs (another tab wrote since the server render), subscribers update in a normal post-hydration render.

Step 4 requires sources to publish or refresh soon after starting. The spec should require this: a watch that never publishes leaves a hydrated entry silently stale.

### Store and DevTools surface

- `DataStoreEntrySnapshot` gains `watching: boolean`.
- `onEntryChange` fires on watch start and stop, so DevTools can show live entries.
- `snapshot()` is unchanged. It includes the current value of watched entries, which makes a worker render's `getData()` exactly what that render read.

### Prototype

Part 1 is prototyped in `packages/fig/src/data-store.ts`, with tests in `packages/fig/src/data-watch.test.ts` and `packages/fig-dom/src/data-watch.test.tsx`. It differs from the notes below in three ways:

- **Deferred start and stop.** Commits and releases schedule a microtask that reconciles each touched entry: start a watch if the entry has committed subscribers, stop it if not. Source code therefore never runs inside commit. As a side effect, an owner that unsubscribes and resubscribes in the same turn keeps its running watch, which partly answers the grace-period question below.
- **Explicit host opt-in.** Stores start watches only when their host sets `watchSources: true`. The reconciler's root host sets it; server hosts do not. `createDataStore()` forwards the flag of whichever renderer adopts it.
- **Push-only first reads.** As described under Watch lifetime: started at read time and held by uncommitted read sets (`readHolds` on the entry), the boundary that takes over suspended reads (`holdDataRead`, called from `captureSuspenseBoundary`), and retainers. `RenderAttempt` takes a `releaseDataReads` callback and calls it whenever it discards a read set (`resetReads`, `rollback`, `dispose`). A Suspense boundary marks its data dependencies dirty each time it renders, so a revealed boundary drops the keys it took over.
- **Side benefit for loads.** Because a fallback boundary now subscribes to the keys its content waits on, unmounting that fallback triggers the existing cleanup for orphaned value-less loads, so an abandoned load stops fetching instead of running until it settles.
- **Dependent retention reuses the ensure retainer count.** Each dependent generation adds one retainer to the entries it ensured and removes it when its signal aborts, so eviction logic needed no new condition.

### Implementation notes

- `Entry` gains `watchController: AbortController | null` alongside `valueController`.
- Start belongs at the point in `commitDataDependencies` where `entry.subscribers.add(owner)` takes the entry from zero subscribers to one. Stop belongs where `deleteDataOwner` removes the last subscriber, and in `evictEntry`.
- Start must run after the commit's subscription installation finishes, because a source may publish synchronously. That publish then goes through the existing post-commit correction path ("a missed change schedules a synchronous correction for a visible reader").
- `publish` shares `hydrateEntry`'s ordering rule: publish first, then call abort listeners, and never overwrite a successor after calling them.
- Watch and load generations are independent. Loads still abort their own predecessors. A publish supersedes a pending load. A load fulfilling after a publish is a newer authoritative value, matching last-writer-wins between refresh and push.

## Store Handle In Load And Watch

Load and watch contexts carry `data`, a `FigDataStoreHandle` for the store running them. This lets one resource derive from another without passing objects through keys:

```ts
const connection = dataResource({
  key: (userId: string) => ["db", userId],
  load: async (userId, { signal }) => openDatabase(userId, { signal }),
});

const rows = dataResource({
  key: (userId: string) => ["rows", userId],
  load: async (userId, { data }) =>
    (await data.ensureData(connection, userId)).rows(),
  watch: (userId, { data, publish, fail, signal }) => {
    data.ensureData(connection, userId).then((db) => {
      if (!signal.aborted) db.subscribe(publish, { signal });
    }, fail);
  },
});
```

- **Stable keys.** `rows` is keyed by `userId` alone, so a server or worker render and the client produce the same keys, and `getData()` hydrates. Keying a derived resource by an object instance (as Orbit first did) produces keys no other environment can match.
- **Dependent retention.** `data.ensureData` retains the ensured entry for as long as the calling generation lives: a load's generation while its value is visible (or until it is superseded or fails), a watch while it runs. A source therefore stays cached while anything derived from it is on screen, and becomes evictable on its own retention schedule once the last dependent retires. The other handle methods behave as on any handle and retain nothing.
- **Same store everywhere.** On the server the handle is the request's store, so dependent loads share the request cache and both entries appear in `getData()`.
- **Direct callers.** Code that calls a resource's `load` itself (an HTTP endpoint exposing a loader, a test) must now pass `data`, typically a per-call `createDataStore()` it disposes afterwards. This is a type-level breaking change for those callers.
- **Cancellation.** A dependent's `data.ensureData` wait is scoped to the dependent's signal. If the load or watch is retired while waiting, that wait rejects with the signal's reason and releases its hold. The dependency's own load or watch is not cancelled: other callers and readers waiting on it keep it running, and if nothing else holds it, it stops and evicts like any unheld entry.
- **Retention is not reactivity.** Keeping `connection` cached does not make `rows` update when `connection` changes. A derived resource updates only if its own `watch` subscribes to the source, as the example above does.
- **No automatic invalidation cascade.** Invalidating `connection` does not invalidate `rows`. Dependency-driven invalidation can be added later from the same retention records if a real case needs it.

### One ownership rule

An entry is **held** while it has committed readers, uncommitted reads (renders in progress and the Suspense boundaries that took their reads over), or retainers (awaiting `ensureData` callers and dependent generations). Every eviction path (orphaned-load cleanup, the preload window, inactive cleanup, and push-only watch reconciliation) asks the same question through one check. A held entry is never evicted, and a new kind of ownership is added to that check once rather than to each path.

## Part 2: `data.setData`

A typed, client-authoritative write to one entry:

```ts
data.setData(resource, [args...], valueOrUpdater);
```

- It reuses `hydrateEntry` semantics: create or replace, supersede pending and current generations, clear stale and error state, publish at the ambient lane.
- An updater receives the current value, or `undefined` when there is none.
- Args are passed as a tuple, because a trailing value cannot follow a variadic rest parameter in TypeScript. This breaks from the other handle methods (see Open Questions).
- Unlike `invalidateDataKey`, it receives the resource, so it can install the lazy store.

This mostly serves remote-only data: write a mutation's returned value without a refetch. A watched entry does not need it, because its source publishes.

## Part 3: Optimistic Overlays

An overlay is a temporary transform applied on top of an entry's authoritative value, owned by a signal:

```ts
start(async (signal, update) => {
  data.overlayData(todos, [listId], (current) => upsert(current, draft), {
    signal,
  });
  await saveTodo(draft, { signal });
  await data.refreshData(todos, listId);
});
```

- **Visible immediately.** Adding an overlay schedules readers at urgent priority, even inside a transition, matching React's `useOptimistic`.
- **Rebased.** Each new base value (load, publish, hydration, `setData`) is passed through all active overlays in insertion order. Updaters must therefore be idempotent over a base that already contains the change, e.g. upsert by id rather than append.
- **Retired with its owner.** When the signal aborts, the overlay retires. The retirement is scheduled in the lane captured when the overlay was added. Called inside a transition, the overlay disappears in the same commit as that transition's other updates, so there is no flicker between "overlay removed" and "real value published".
- **Server.** Overlays are ignored on the server and never appear in `snapshot()`.

### Reconciler requirement

Retiring in a captured lane means a read must know whether the current render includes that lane. This is the same question hook update queues answer when rebasing. The store host would need one new callback, roughly `includesRenderLane(lane): boolean`.

Speculative read snapshots must also record the overlay set they observed, so validation catches an overlay added or retired between chunks. This is the riskiest part of the proposal. Its design should be reviewed against the hook-queue rebasing code before anything is implemented.

### Do we need Part 3 in core?

Local-first apps mostly do not. A write to the local database is authoritative locally and publishes through the watch immediately; sync is background work. Optimism matters for remote-only resources, which are `fig-query`'s domain.

Ship Parts 1 and 2 first. Build Part 3 when `fig-query` mutations need it, and only if a userland overlay (wrapping a resource and publishing through `setData`) cannot avoid the flicker without lane access.

## How Packages Build On This (non-normative)

### `@bgub/fig-db`

A live query compiles to a watched resource:

```ts
export function liveQuery<TParams extends DataResourceKeyInput, TRow>(
  name: string,
  query: (params: TParams) => Query<TRow>,
) {
  return dataResource({
    key: (params: TParams) => [`fig-db:${name}`, params],
    load: (params, { signal }) => query(params).snapshot({ signal }),
    // A real adapter would ensure a shared database resource through `data`
    // and subscribe-then-publish to close the snapshot/subscription gap.
    watch: (params, { publish, signal }) => {
      query(params).subscribe(publish, { signal });
    },
    equals: sameRows,
  });
}
```

The engine underneath (TanStack DB at first) owns incremental maintenance and structural sharing. Fig sees only keyed values.

### Worker-side rendering

A service worker is one more request environment with one store per navigation:

1. The worker's `load` reads an IndexedDB snapshot.
2. `renderToDocumentStream` renders; `getData()` captures exactly what was read.
3. The client hydrates that snapshot. Hydration is consistent even if another tab wrote in between.
4. Watches start at commit and publish any newer local state.
5. Sync runs in the background and its writes arrive through the same watches.

No worker-specific data API is required.

The integration milestone that proves this contract end to end: stable logical keys (no instance ids), a transactionally captured IndexedDB snapshot read in the worker, worker rendering, Fig Data hydration of exactly that snapshot, and post-commit live updates. Its key test has another tab write between the worker render and hydration; the page must hydrate without mismatch and then show the newer write. The current WSR demo passes its snapshot through props and Orbit does not render in a worker, so neither proves the full contract yet.

### `@bgub/fig-query`

`fig-query` packages policy as resource options: focus and reconnect refetch, polling, and retry with backoff, all through `watch` plus `refresh`. Mutations use `setData`, and later overlays. Its surface can stay small because cache semantics already live in core.

## Testing Plan

- **Lifetime:** a watch starts only after commit; never on speculative, strict-shadow, preload, ensure, or server reads; stops on last release, eviction, and disposal with the right reasons.
- **Hydration:** hydration renders the hydrated value even when the source differs; the post-commit publish updates readers.
- **Races:** a publish supersedes a pending load; a load fulfilling after a publish wins; a publish from inside an abort listener does not get overwritten.
- **Read-set validation:** a publish between render chunks triggers a retry, not a mixed commit; a synchronous publish during watch start is corrected after commit.
- **`equals`:** equal publishes and equal load/refresh results schedule nothing, keep the visible value's identity, and keep its generation authoritative.
- **Failure:** `fail` and synchronous throws keep stale values visible; with no value, the entry rejects into an ErrorBoundary.
- **Activity:** hidden readers keep a watch alive at offscreen priority; full unmount stops it.
- **Orbit port:** replace its whole-collection `useSyncExternalStore` with live resources as an integration check. Done; its snapshots are keyed by user and ensure the store through `data`.
- **Review fixes:** an equal publish during a refresh keeps the visible generation; an equal publish clears a recorded failure; a discarded push-only read stops its watch as soon as its render attempt is discarded; a fallback holds a slow push-only watch indefinitely and hands it to the revealed reader without a restart; unmounting a waiting fallback stops the watch; `refresh` resolves with its outcome, including `"released"` after the watch stops.
- **Dependents:** an ensured dependency stays cached while its dependent is visible and evicts on its own schedule after the dependent does. Retiring a dependent ends its pending wait (rejecting with the signal's reason) and stops a push-only dependency nothing else waits on, while an independent caller waiting on the same dependency still receives its value.
- **Ownership:** no eviction path removes an entry an uncommitted render still holds, including when a committed reader of the same key unmounts and when a Suspense boundary is replaced by a new one waiting on the same read; a value published to an entry held only by uncommitted reads survives inactive cleanup until those reads are released.

## Open Questions

1. **Naming.** `watch` was chosen to avoid confusion with `useSyncExternalStore`'s `subscribe(listener) => unsubscribe` shape. Alternatives: `live`, `source`, `sync`.
2. **Stop grace period.** Stopping on the last release may thrash sources when a component remounts quickly (key changes, Suspense retries). Options: a per-resource `watchGraceMs`, or reuse inactive retention with a short default.
3. **Should `ensureData` start a watch?** Route loaders `await` data the next render will read anyway, so starting early could save a round trip on first publish. This proposal says no for live resources, to keep "watch iff committed interest" simple. For push-only resources it must, since the watch is the only way to get a value; the caller's retainer holds that watch until it resolves.
4. **`setData` argument shape.** The tuple form breaks the handle's rest-args convention. Alternative: `data.setData(resource, valueOrUpdater, ...args)`.
5. **Overlay lane access.** Is a new `includesRenderLane` host callback acceptable, or should overlays live outside core until a second consumer needs them?
6. **Server watches.** A long-lived server render (a streaming dashboard) could watch until `allReady`. Out of scope for now; a server render reads a snapshot.

## Spec Impact

Done for Part 1:

- `docs/concepts/data.md`: resource kinds, `equals`, per-resource retention and the ownership rule, watched resources (lifetime, push-only waiting, publish/fail/refresh, hydration), and dependent resources.
- `docs/concepts/hydration.md`: the commit-then-watch ordering.
- `docs/concepts/rendering.md` and `docs/concepts/architecture.md`: Suspense boundaries taking over waiting reads, discarded read sets, and the `watchSources` host flag.
- `docs/concepts/intentional-differences-from-react.md`: watches as part of the resource.

Still to do:

- A `.tegami/` changelog for `@bgub/fig` and `@bgub/fig-reconciler`, flagging that direct `load` callers must now pass `data`.
- `docs/concepts/data.md` sections for `setData` and overlays if Parts 2 and 3 ship.
- `docs/plans/open-questions.md`: resolve or narrow the `useOptimistic` and TanStack Query adapter entries once `fig-query` exists.
