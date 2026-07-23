# Data Resources

Status: stable

Data resources give async values a stable key, a loader, and a store. Components can read them with Suspense, frameworks can preload them, and server rendering can hand the same values to the browser.

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

`dataResource` may omit `load`. This creates a hydrate-only resource: the browser can read values received from a server, but cannot load or refresh them itself. `refreshData` reports `{ status: "unsupported", reason: "no-client-loader" }` for that case.

Server-only loaders use the same API inside a framework-protected server module. When browser and server code need one identity, put a key-only definition in shared code and a loader-backed definition with the same key on the server.

Fig joins them by key during hydration. It does not infer server safety from filenames or rewrite modules for the browser.

Loader-backed and hydrate-only are the only resource kinds. Remote endpoints are a framework concern, not a third store mode.

## Loader Lifetimes

A loader receives its resource arguments followed by `{ signal }`. The signal belongs to the current **load generation**, not merely to its promise.

After a load fulfills, its generation stays authoritative while that value is visible. Its signal aborts when:

- a newer load successfully publishes;
- server hydration replaces the value;
- the entry is evicted;
- the store is disposed; or
- that generation rejects.

Starting a refresh does not immediately revoke a visible stale value. If the refresh fails, the previous generation remains authoritative. A pending load with no visible value aborts as soon as another load supersedes it. `invalidateData` only marks an entry stale and does not abort it.

Internal adapters receive two additional generation-guarded capabilities. `hydrate` applies Payload data rows through the current store. `attributeError` associates a streamed hole failure with the owning value.

Both stop working once their generation loses authority. A loader cannot replace its own entry using a data row from its own Payload response.

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

The thrown pending promise always resolves; rejection is stored on the entry, and the next render throws the actual error. Subscription bookkeeping is commit-aware, so abandoned renders and strict shadow passes do not leave subscribers behind. Unmounting releases the subscription and may abort orphaned work.

DevTools records the keys read directly by each committed fiber. Selecting the root shows the whole store, including hydrated or preloaded entries without a current subscriber.

### Before render

`preloadData` starts a load without subscribing. An unclaimed preload is aborted and evicted after 30 seconds by default. Fulfilled, inactive entries are evicted after five minutes by default.

`ensureData(resource, ...args)` is the awaitable read for route loaders and actions. It resolves the same value `readData` would see:

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

Payload components use the same freshness APIs as every other data resource: `preloadData(ProfilePage, props)`, `refreshData(ProfilePage, props)`, and `invalidateData(ProfilePage, props)`. After an `await`, use the corresponding method on a previously captured data-store handle.

## Invalidating And Refreshing

Fig has two freshness ideas:

- **Invalidate:** mark stale and reload on the next read.
- **Refresh:** fetch now.

The invalidation functions differ only in how they find entries:

- `invalidateData(resource, ...args)` targets a resource and arguments.
- `invalidateDataKey(key)` targets one serialized key.
- `invalidateDataError(error)` targets every key attributed to an error and returns whether any were found.
- `invalidateDataPrefix(prefix)` structurally matches every existing key beginning with that tuple.

Invalidation also clears cached rejections and stored refresh errors, allowing the next read to try again.

`refreshData(resource, ...args)` never rejects. It resolves to one of:

- `fulfilled`;
- `rejected`, with the error and optional stale value;
- `aborted`, because it was superseded, evicted, or its store was disposed; or
- `unsupported`, for a resource with no browser loader.

A failed refresh leaves the stale value visible and records `refreshError`. Reads do not automatically retry that persistent failure, which avoids refresh storms. Another explicit invalidate or refresh re-arms it.

For example, if a profile page already shows Ada and a background refresh fails, the page keeps showing Ada. Fig reports the failed refresh to the caller but does not turn the visible profile into an error screen or retry on every render.

All settlements are generation-guarded. Results from superseded work are inert.

Invalidating a hydrate-only entry leaves its current value readable. Only later server or Payload hydration can replace it.

## Ambient And Explicit Stores

Free data functions use the ambient store only while Fig is running synchronously: render, event dispatch, effects, or the synchronous prefix of an action or transition. That ambient slot is gone after `await`.

Async code captures an explicit handle before yielding:

```ts
const data = readDataStore();

await save();
await data.refreshData(userResource, id);
```

`root.data` exposes the same handle. It supports `ensureData`, invalidation, preloading, refresh, hydration, and `run`.

## Store Ownership And SSR

Client stores belong to one root; server stores belong to one request. Fig has no process-global cache.

`createDataStore({ partition, initialData })` creates a store before a renderer exists, which is useful for route loading. `createRoot`, `hydrateRoot`, or a server render then adopts that exact store and owns its disposal. One store cannot back two roots.

When passing a pre-created store, configure `partition` and `initialData` at store creation rather than on the renderer.

`snapshot()` and `hydrate(entries)` form the server/client handoff. Server render results expose the adopted handle as `data` and settled entries through `getData()`. Payload streams carry the same entries as `data` rows. The client may pass `initialData`, call `root.data.hydrate`, or let Payload decoding hydrate through its guarded capability.

Hydration acts like a successful server-pushed refresh: it creates a missing entry, supersedes local work for that key, clears stale and error state, stores the new value, and notifies subscribers. Only settled values hydrate.

During Payload navigation, data rows travel in the same response as the serialized route tree. A separate endpoint loader is needed only for later browser cache misses and refreshes.

## Serialized Trees As Data

`createPayloadComponent` delivers a serialized component tree through an ordinary data-resource entry. The resource key is the refresh boundary. The root value may be fulfilled while nested streamed holes are still pending.

Decoding, asset preparation, and data-row hydration remain bound to the load generation. Once a newer generation takes over, late rows from the old stream cannot mutate the store or publish assets.

## Error Attribution

Object errors thrown through `readData` are tracked in a garbage-collectable side table. `ErrorInfo.dataResourceKeys` tells a boundary which keys failed, and `invalidateDataError(error)` resets those exact entries. The UI still decides when to remount or reset the boundary.
