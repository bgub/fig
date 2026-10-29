# Data Resources

Status: stable

Data resources give async values a stable key, a loader, and a store. Components can read them with Suspense, frameworks can preload them, server rendering can hand the same values to the browser, and a watch can keep them live while they are on screen.

Asset delivery is a separate system described in [assets.md](./assets.md).

## Defining A Resource

```ts
const userResource = dataResource({
  key: (id: string) => ["user", id],
  load: async (id, { signal }) => fetchUser(id, signal),
});
```

The key is the resource's identity. Its first item is a required string namespace; the rest distinguishes values. There is no second resource id.

Keys use a strict stable encoder rather than `JSON.stringify`. Object keys are sorted, `-0` is normalized, and unsupported values such as `undefined`, non-finite numbers, and non-plain objects throw.

Development builds also detect cases where one key comes from meaningfully different arguments. `debugArgs` is available when arguments are intentionally non-serializable.

`dataResource` may omit `load`. This creates a hydrate-only resource: the browser can read values received from a server, but cannot load or refresh them itself. `data.refreshData` reports `{ status: "unsupported", reason: "no-client-loader" }` for that case.

Server-only loaders use the same API inside a framework-protected server module. When browser and server code need one identity, put a key-only definition in shared code and a loader-backed definition with the same key on the server.

Fig joins them by key during hydration. It does not infer server safety from filenames or rewrite modules for the browser.

A resource may also declare a `watch` that pushes values while the key is in use (see [Watched Resources](#watched-resources)). The four kinds follow from which of `load` and `watch` it has:

| `load` | `watch` | Kind | Server read | Client read |
| --- | --- | --- | --- | --- |
| yes | no | loader-backed | `load` | `load`, refresh |
| no | no | hydrate-only | hydrated only | hydrated only |
| yes | yes | live | `load` | `load`, then watch pushes |
| no | yes | push-only | hydrated only | suspends until the first publish |

Remote endpoints are a framework concern, not another store mode.

Two more options apply to every kind:

- `equals(previous, next)` decides whether a new value replaces the visible one. It defaults to `Object.is`. An equal value from a load, refresh, or publish keeps the visible value, its identity, and the generation that produced it, and renders nothing; it still counts as a successful update, so it clears `stale` and any recorded refresh error. Structural comparison is opt-in.
- `inactiveRetentionMs` overrides the store's inactive retention for this resource's entries (see [Before render](#before-render)).
- `dehydrate` and `rehydrate` decide what an entry transfers from server to client (see [Transfer rules](#transfer-rules)).

## Loader Lifetimes

A loader receives its resource arguments followed by `{ signal, data }`. The signal belongs to the current **load generation**, not merely to its promise. `data` is the store running the load (see [Dependent Resources](#dependent-resources)).

After a load fulfills, its generation stays authoritative while that value is visible. Its signal aborts when:

- a newer load successfully publishes;
- server hydration replaces the value;
- the entry is evicted;
- the store is disposed; or
- that generation rejects.

Starting a refresh does not immediately revoke a visible stale value. If the refresh fails, the previous generation remains authoritative. If it settles to a value `equals` the visible one, the previous generation also remains authoritative and the refresh's own generation retires as `"superseded"`. A pending load with no visible value aborts as soon as another load supersedes it. `data.invalidateData` only marks an entry stale and does not abort it.

The signal reason identifies that retirement: `"superseded"`, `"evicted"`, or `"store-disposed"`. A generation that rejects aborts with its rejection reason; a reasonless rejection receives the platform's default `AbortError`. Invalidating a generation through an attributed error aborts with that error.

Internal adapters receive two additional generation-guarded capabilities. `hydrate` applies Payload data rows through the current store. `attributeError` associates a streamed hole failure with the owning value.

Both stop working once their generation loses authority. A loader cannot replace its own entry using a data row from its own Payload response.

Hydration rechecks that authority between entries in a batch: replacing an entry may invoke an abort listener that synchronously retires the delivering generation. Entries already applied remain published, but the retired generation cannot apply the rest of the batch over its successor's data.

The data layer does not own request context or dependency injection. A framework can close over request state in a per-request server resource or call its own endpoint from a browser loader.

## Remote Refresh

Refreshing a server value from the browser requires an endpoint, so frameworks own that transport. Compose a normal loader-backed resource with `createServerFn`, `fetch`, or another endpoint primitive:

```ts
const postResource = dataResource({
  key: (id: string) => ["post", id],
  load: (id, { signal }) =>
    fetch(`/api/posts/${id}`, { signal }).then((response) => response.json()),
});
```

The store still sees an ordinary resource. It owns caching, generations, stale values, and errors; the endpoint owns serialization, authentication, authorization, and input validation.

## Reading Data

### During render

`readData(resource, ...args)` subscribes the current fiber to the key. It returns a cached value, throws a pending promise to Suspense, or throws the real loader error to ErrorBoundary.

The thrown pending promise always resolves; rejection is stored on the entry, and the next render throws the actual error. Subscription bookkeeping is commit-aware, so abandoned renders and strict shadow passes do not leave subscribers behind. The render attempt owns explicit data read sets, separate from committed fiber subscriptions, and records the values read by a speculative render and validates them before concurrent commit. If hydration or a refresh changes a value between render chunks, Fig retries before publishing mixed snapshots, including on an initial mount with no committed subscribers. Repeated reads retain the first observed value for validation; discarded attempts and committed subscriptions release those temporary snapshots. Subscription commit checks those snapshots again after installing all subscriptions and running subscription cleanup, before releasing the observations. This closes the notification gap when deletion cleanup or another commit callback changes data before a new reader subscribes. A missed change schedules a synchronous correction for a visible reader, flushed after commit (or after deferred capture release); hidden readers retain offscreen priority. Suspense and error-boundary checkpoints cover read ownership independently of commit-index membership, including when a preserved primary keeps discarded fibers reachable. The data store validates and commits explicit read sets; it has no pending-owner snapshot map. Unmounting releases the subscription and may abort orphaned work. Server reads do not subscribe or record speculative dependency snapshots; their data store belongs to the request.

DevTools records the keys read directly by each committed fiber. Selecting the root shows the whole store, including hydrated or preloaded entries without a current subscriber.

### Before render

`data.preloadData` starts a load without subscribing. An unclaimed preload is aborted and evicted after 30 seconds by default. Fulfilled, inactive entries are evicted after five minutes by default; a resource's `inactiveRetentionMs` overrides that for its own entries, and `Infinity` keeps them until the store is disposed. Hydrated entries use the store default until a resource reads them. Eviction aborts the value generation's signal, so a resource whose value owns a connection (an open database, a socket) closes it there.

An entry is **held** while it has committed readers, uncommitted reads (a render in progress, or a Suspense boundary showing its fallback while it waits on the read), or retainers (awaiting `data.ensureData` calls and dependent loads and watches). No eviction path removes a held entry: orphaned-load cleanup, the preload window, inactive cleanup, and push-only watch shutdown all ask the same question.

`data.ensureData(resource, ...args)` is the awaitable read for route loaders and actions. It resolves the same value `readData` would see:

- a cached value immediately, while stale data revalidates in the background; or
- the winning load result on a cache miss.

It follows superseding loads and server hydration instead of exposing an internal superseded error. It does not subscribe, but an active caller retains the entry so preload eviction cannot abort its work.

TanStack Router's `ensureRouteData` awaits this operation and returns `void`; the component still calls `readData`. This keeps one cache instead of copying the result into Router `loaderData`.

### Payload components

`createPayloadComponent` from `@bgub/fig-dom` returns one callable object that is both a component and a data resource. Rendering it reads the decoded Payload tree; explicit store and route APIs accept the same object directly:

```tsx
const ProfilePage = createPayloadComponent<{ id: string }>({
  key: ["profile"],
  load: loadProfilePayload,
});

await ensureRouteData(context, ProfilePage, { id: "42" });
return <ProfilePage id="42" />;
```

The complete props are appended to the namespace key by default using a canonical encoding of Payload-compatible values. Plain-object property order is canonicalized before graph ids are assigned, so equivalent props share an entry even when callers construct them in a different order. `cacheKey(props)` replaces only that props portion and explicitly opts into sharing one entry across unequal props. Development argument-fingerprint diagnostics still report accidental sharing.

Payload components use the same freshness APIs as every other data resource: `data.preloadData(ProfilePage, props)`, `data.refreshData(ProfilePage, props)`, and `data.invalidateData(ProfilePage, props)`. Capture the data-store handle during render and use it before or after an `await`.

## Invalidating And Refreshing

Fig has two freshness ideas:

- **Invalidate:** mark stale and reload on the next read.
- **Refresh:** fetch now.

The invalidation functions differ only in how they find entries:

- `data.invalidateData(resource, ...args)` targets a resource and arguments.
- `data.invalidateDataKey(key)` targets one serialized key.
- `data.invalidateDataError(error)` targets every key attributed to an error and returns whether any were found.
- `data.invalidateDataPrefix(prefix)` structurally matches every existing key beginning with that tuple.

Invalidation also clears cached rejections and stored refresh errors, allowing the next read to try again.

`data.refreshData(resource, ...args)` never rejects. It resolves to one of:

- `fulfilled`;
- `rejected`, with the error and optional stale value;
- `aborted`, because it was superseded, evicted, or its store was disposed, or (from a watch's `refresh`) because the watch was released; or
- `unsupported`, for a resource with no browser loader.

A failed refresh leaves the stale value visible and records `refreshError`. Reads do not automatically retry that persistent failure, including a rejection with an `undefined` reason, which avoids refresh storms. Another explicit invalidate or refresh re-arms it.

For example, if a profile page already shows Ada and a background refresh fails, the page keeps showing Ada. Fig reports the failed refresh to the caller but does not turn the visible profile into an error screen or retry on every render.

All settlements are generation-guarded. Results from superseded work are inert. Load replacement and retirement publish their state before invoking abort listeners, which may synchronously refresh, hydrate, invalidate, or dispose the store. Work started by those listeners retains its own generation and pending result; the retiring operation cannot overwrite or detach it. A replacement loader does not run if an abort listener supersedes it or disposes the store before it starts.

Reading a loader result's `then` property may throw. That failure follows normal load rejection handling, including preserving a stale value and resolving `data.refreshData` with a rejected result.

Invalidating a hydrate-only entry leaves its current value readable. Only later server or Payload hydration can replace it.

## Watched Resources

A `watch` pushes values into a resource's entry while something on screen reads it:

```ts
const projectIssues = dataResource({
  key: (projectId: string) => ["issues", projectId],
  load: (projectId, { signal }) => issues.query({ projectId }, { signal }),
  watch: (projectId, { publish, signal }) => {
    issues.subscribe({ projectId }, publish, { signal });
  },
});
```

Components keep calling `readData`. Like every Fig callback, `watch` receives a signal and returns `undefined`. Its context also carries `publish`, `fail`, `refresh`, `invalidate`, and `data`, all as properties, so a source can destructure them and pass them as listeners.

### Watch lifetime

A watch has its own generation, separate from load generations.

- **Start.** A live resource's watch starts when its entry gains its first committed reader. Speculative reads, strict shadow renders, `data.preloadData`, `data.ensureData`, and server rendering never start one. Watches start and stop a microtask after the commit or release that decides it, so source code never runs inside commit and a reader replaced within the same turn keeps the running watch.
- **Push-only exception.** A push-only resource has no `load`, so its watch is also its first read. A value-less read starts the watch immediately, and whatever is waiting holds it open: the render in progress, the Suspense boundary that shows a fallback while waiting (it takes over the reads its suspended content was waiting on and subscribes to them), or an awaiting `data.ensureData` call. There is no time limit, so a slow source is never restarted. When the content reveals, its reader subscribes and the boundary lets go in the same commit. When nothing waits any more (the render is discarded, the fallback unmounts), the watch stops and the value-less entry evicts, waking any suspended reader. For a push-only resource, `data.ensureData` starts the watch and resolves with its first publish, `data.preloadData` does nothing, and `data.refreshData` reports `unsupported`.
- **Stop.** A watch stops when its entry has no committed reader, is evicted, or its store is disposed. The signal reason is `"released"`, `"evicted"`, or `"store-disposed"`. A released entry keeps its value but is marked stale, so the next read revalidates through `load` (or, for a push-only resource, through the next watch).
- **Hidden Activity.** Readers inside a hidden Activity count as committed readers. Their watch keeps running and its updates render at offscreen priority.
- **After stop.** `publish`, `fail`, `refresh`, and `invalidate` are inert once the watch's signal aborts.

### Publish, fail, refresh

- `publish(value)` acts like a generation-guarded hydration of one entry. It creates or replaces the value, clears `stale`, errors, and refresh errors, and supersedes an in-flight load, which resolves `aborted: "superseded"`. Its priority is the ambient lane: wrap it in `transition()` to publish at transition priority. An equal value keeps the visible value and generation, still supersedes an in-flight refresh, and still clears failure state.
- `fail(error)` follows refresh-failure semantics. With a visible value, the value stays and `refreshError` is recorded; reads do not retry on their own. Without a value, the entry rejects into the nearest ErrorBoundary. A watch that throws synchronously is equivalent to `fail(thrown)`.
- `refresh()` reruns `load` for the watched key and resolves with the same `DataRefreshResult` as `data.refreshData`: `unsupported` for push-only resources, and `aborted` with the watch's reason once it has stopped. Policy adapters use the result for retry and backoff.
- `invalidate()` marks the key stale.

Use `publish` when the source delivers the value itself: a live-query callback with current results, a socket message carrying a snapshot, a synchronous in-memory store. Use `refresh` when it only reports that something changed: a BroadcastChannel ping, a "row updated" event, a focus or reconnect event. Re-reading by hand in response to a notification can publish an older read over a newer one; `refresh` cannot, because a newer load supersedes an older one.

```ts
watch: (projectId, { refresh, signal }) => {
  const channel = new BroadcastChannel("issues");
  channel.addEventListener("message", refresh);
  signal.addEventListener("abort", () => channel.close(), { once: true });
  refresh(); // catch writes made before this watch started listening
};
```

A watch must close the gap between the value already on screen and its subscription. A source that delivers values subscribes and then publishes its current value; a notification-only source refreshes once when it starts. Otherwise a change made between the read (or the server render) and the subscription is never seen.

`publish` replaces the whole value. A source that delivers events or deltas must fold them into a snapshot before publishing; that accumulator belongs to the adapter, as does a connection shared between keys.

### Watches and hydration

A watch never runs on the server. A live resource renders from `load` there; a push-only resource renders only from a hydrated value, like a hydrate-only resource. On the client, hydration renders the hydrated value before any watch starts, because watches start after commit. Each watch then publishes (or refreshes) the current value, and a difference, such as another tab's write since the server render, updates readers in a normal render after hydration.

## Dependent Resources

`data` in a load or watch context is the store running it. A resource can derive from another without passing runtime objects through its key:

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

- **Stable keys.** `rows` is keyed by `userId`, so every environment produces the same key and server or worker render data hydrates on the client. A key built from an object instance cannot be matched anywhere else.
- **Retention.** `data.ensureData` retains the ensured entry for as long as the calling generation lives: a load's while its value is visible (or until it is superseded or fails), a watch's while it runs. The dependency stays cached while anything derived from it is on screen, then evicts on its own retention schedule. Other handle methods retain nothing. For a push-only dependency the hold also keeps its watch running, including when the dependent acquires an already cached or hydrated value.
- **Cancellation.** A dependent's pending `data.ensureData` ends when the dependent is retired, rejecting with its signal's reason. The dependency's own load or watch keeps running for any other caller or reader; if nothing else holds it, it stops and evicts like any unheld entry.
- **Retention is not reactivity.** Keeping `connection` cached does not make `rows` change when it does. A derived resource updates only through its own `watch`, as above. Invalidating `connection` does not invalidate `rows`.
- **Server.** The handle is the request's store, so dependent loads share the request cache and both entries appear in `getData()`.
- **Direct callers.** Code that calls a resource's `load` itself, such as an HTTP endpoint exposing a loader or a test, must pass `data`, typically a `createDataStore()` it disposes afterwards.

## Explicit Store Handles

`readData(resource, ...args)` is the render-time read API. All imperative operations are methods on a store handle: `data.preloadData`, `data.ensureData`, `data.refreshData`, and the four `data.invalidateData*` variants. These operations have no free-function exports.

Capture `readDataStore()` while Fig executes synchronously: during render, event dispatch, effects, or the synchronous prefix of an action or transition. The handle identifies its store and remains usable after `await`:

```ts
const data = readDataStore();

await save();
await data.refreshData(userResource, id);
```

Outside Fig-managed code, use `root.data`, a route's `context.data`, or a store returned by `createDataStore()`. Handle methods do not require an ambient store or a `run` wrapper. `data.run(callback)` remains a synchronous integration scope for code that needs to capture the handle through `readDataStore()`; it does not carry ambient state across an await or establish render context for `readData()`.

A transition's `update(() => ...)` still restores transition scheduling after an await. Calling a store method after an await does not by itself restore transition priority.

## Store Ownership And SSR

Client stores belong to one root; server stores belong to one request. Fig has no process-global cache. Store identity provides isolation; keys are canonical resource keys with no additional partition prefix. If one store holds values for multiple tenants, include tenant identity in each resource key. Hydration entries carry only resource keys and values, so the caller must deliver them to the correct client.

`createDataStore({ initialData })` creates a store before a renderer exists, which is useful for route loading. `createRoot`, `hydrateRoot`, or a server render then adopts that exact store and owns its disposal. One store cannot back two roots.

When passing a pre-created store, configure `initialData` at store creation rather than on the renderer.

`snapshot()` and `hydrate(entries)` form the server/client handoff. Server render results expose the adopted handle as `data` and settled entries through `getData()`. Payload streams carry the same entries as `data` rows. The client may pass `initialData`, call `root.data.hydrate`, or let Payload decoding hydrate through its guarded capability.

Hydration acts like a successful server-pushed refresh: it creates a missing entry, supersedes local work for that key, clears stale and error state, stores the new value, and notifies subscribers. Only settled values hydrate. A batch stops if an abort listener disposes the store while an earlier entry is being replaced.

### Transfer rules

By default an entry's value transfers as is, so it must survive the transport's codec (Fig's Payload value codec for Start and Payload data rows). A resource whose value is live state, such as a database client or a connection, decides its transfer itself:

- `dehydrate: false` keeps its entries out of `snapshot()`, `getData()`, and Payload data rows entirely.
- `dehydrate(value)` sends a serializable form instead of the value. It runs when the snapshot is taken (Payload: when the data row is emitted). If the store is disposed first, disposal runs it before retiring the live value, so a `getData()` called after a server stream closed still sees the last live state.
- `rehydrate(dehydrated, { signal, data })` turns a hydrated value back into a live one the first time a reader names the resource. Until then the entry holds the transferred form, and a snapshot passes it through unchanged. The revived value is its own generation: `signal` aborts when the entry is replaced, evicted, or its store disposed, which is where the revived resource releases what it opened.

```ts
const db = dataResource({
  key: () => ["db"],
  load: ({ signal }) => openClient(signal),
  dehydrate: (client) => client.export(),
  rehydrate: (state, { signal }) => openClient(signal, state),
});
```

### Browser-only loads

A load that needs capabilities the current environment lacks, such as IndexedDB on the origin server, calls `requireBrowser(reason?)` from `@bgub/fig` after checking for them. It throws `BrowserRequiredError` and the entry rejects with it.

- During server rendering, a read of that entry calls `readBrowser(reason)`: the nearest Suspense boundary keeps its fallback and is marked for browser rendering, with no `onError` report. A requirement thrown before the load does any asynchronous work settles at once and is decided in the shell; one discovered later reaches the browser as a streamed operation.
- `data.ensureData` rejects with the error, so server route loaders should not ensure browser-only data.
- Where the capability exists (a service worker with IndexedDB, the browser), the same load simply proceeds.

This builds on `readBrowser` ([browser-only rendering](./server-rendering.md#browser-only-rendering)).

During Payload navigation, data rows travel in the same response as the serialized route tree. A separate endpoint loader is needed only for later browser cache misses and refreshes.

## Serialized Trees As Data

`createPayloadComponent` delivers a serialized component tree through an ordinary data-resource entry. The resource key is the refresh boundary. The root value may be fulfilled while nested streamed holes are still pending.

Decoding, asset preparation, and data-row hydration remain bound to the load generation. Once a newer generation takes over, late rows from the old stream cannot mutate the store or publish assets.

## Error Attribution

Object errors thrown through `readData` are tracked in a garbage-collectable side table. `ErrorInfo.dataResourceKeys` tells a boundary which keys failed, and `data.invalidateDataError(error)` resets those exact entries. The UI still decides when to remount or reset the boundary.
