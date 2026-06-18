# Data Resources Proposal

## Summary

Data resources are Fig's key-addressable async render inputs: server reads,
cached async values, and other data dependencies that can be read during render,
deduped by key, refreshed, invalidated, and coordinated with Suspense,
transitions, server actions, and RSC refresh.

This proposal intentionally separates data resources from asset resources. Data
resources are about freshness and dependency identity; asset resources are about
delivery of CSS, scripts, preloads, fonts, preconnects, and other
render-discovered assets.

The recommended direction is a small Fig core protocol plus an opinionated
default implementation. Fig defines the render, cache-store, refresh, and RSC
protocol semantics, and the defaults are usable without another library.
Frameworks and data libraries remain free to override long-lived persistence,
stale-time policy, retry policy, normalized caches, polling, and route
conventions.

## Goals

- Provide a first-class, key-addressable async data primitive.
- Preserve Fig's explicit API style instead of React's broad `use(resource)`.
- Make Suspense data reads stable and documented.
- Give refresh a precise target: one or more data resource keys.
- Let server actions invalidate or refresh the data they mutate.
- Support server, client, and shared resource definitions.
- Avoid global process caches by default on the server.
- Ship useful default cache behavior while keeping policy hooks pluggable.
- Create a foundation for future RSC refresh and full-stack framework work.

## Non-Goals

- A full TanStack Query replacement in Fig core.
- Mandatory TTL, retry, polling, background refetch intervals, normalized entity
  storage, or persistence.
- Forcing all loaders to be isomorphic.
- Hiding server/client boundaries from application authors.
- Treating asset delivery as data-resource behavior.

## Terminology

- A **data resource** is a definition: a function that computes a key and a
  function that loads the value.
- A **data resource key** is the serializable identity of one logical value. It
  is an array whose first element is a string namespace, for example
  `["user", id]`. The namespace distinguishes definitions; the rest distinguishes
  values within a definition.
- A **data resource entry** is a store record for one key. It may be pending,
  fulfilled, rejected, stale, or refreshing.
- An entry has a **refresh mode**. A **loader-backed** entry has a
  client-runnable loader and follows the default refresh-on-read policy. A
  **hydrate-only** entry was populated from a streamed server-only value, has no
  client loader, and revalidates only through RSC dependency refresh.
- A **data resource store** owns entries for a render request, root, RSC
  response, or framework-managed lifetime. It is a flat map from normalized key
  to entry.
- A **refresh** re-runs the loader for a key and publishes a newer value.
- An **invalidation** marks a key stale so the next read or explicit refresh
  obtains a newer value.

## Public API

The common case is a definition plus explicit render reads.

```ts
import { dataResource, readData } from "@bgub/fig-data";

export const userResource = dataResource({
  key: (id: string) => ["user", id],
  load: async (id: string, { signal }) => {
    const response = await fetch(`/api/users/${id}`, { signal });
    return response.json() as Promise<User>;
  },
});

function Profile({ id }: { id: string }) {
  const user = readData(userResource, id);
  return <h1>{user.name}</h1>;
}
```

The initial helper set stays small:

```ts
dataResource(options);
dataResource.client(options);

readData(resource, ...args);
preloadData(resource, ...args);
invalidateData(resource, ...args);
refreshData(resource, ...args);
```

The read API stays explicit. Fig already uses `readContext(context)` and
`readPromise(promise)` because render inputs are not hook slots; `readData(...)`
fits that model better than a broad `use(...)`.

### Identity Is The Key

A resource has no separate `id` field. The `key` is the whole identity: its first
element is a required string namespace that distinguishes definitions, and the
remaining elements distinguish values within that definition. This collapses what
would otherwise be two concepts (a definition id plus a value key) into one, and
it makes serialization fall out for free — the store is a flat
`Map<normalizedKey, entry>`, and the value passed to `invalidateData`/
`refreshData`, the value stored, and the value streamed across the wire are all
the same key.

```ts
key: (...args: TArgs) => readonly [string, ...DataResourceKeyInput[]];
```

`key` is required (the type enforces the string head). The cost is one familiar
line even for a throwaway resource; the benefit is a single identity concept, a
flat store, free hydration lookup (the client recomputes the same key and finds
the streamed entry — no id-to-resource registry), and namespace-level tooling:

- **collision detection**: an entry records which resource loaded it; in
  development, a read or load of the same key by a _different_ resource warns.
- **prefix operations** (future): a flat namespaced keyspace makes
  `["user"]`-prefix invalidation natural, TanStack-style.

### Definition Variants

Variants communicate runtime constraints:

- `dataResource(...)`: shared definition. The loader must be safe in every
  runtime where it can be read.
- `dataResource.client(...)`: client-only definition. Server reads throw.
- `dataResource.server(...)`: deferred until the server-only packaging strategy
  exists (see Packaging And Layering). A runtime throw is enough for
  experimentation but not for a stable server-only guarantee.

### `readData` Versus `readPromise`

`readPromise(promise)` remains right when the app already has a specific promise
instance — a promise created by a Server Component and passed to a Client
Component, or one-off async work where promise identity is the dependency
identity.

`readData(resource, ...args)` is for keyed, refreshable, deduped values where Fig
owns the loader and store entry. It adds stable key identity, subscriber
tracking, invalidation, refresh, cancellation, DevTools visibility, and RSC
refresh integration. The implementation can reuse the same thenable ping
machinery as `readPromise(...)`, but the contract differs: promises are passive
values, data resources are reactive store entries.

## Packaging And Layering

The first stable surface should live in a separate package such as
`@bgub/fig-data` while the design settles, to reduce semver pressure while
server packaging and RSC refresh evolve.

### Layering Contract

`dataResource(...)`, key normalization, and drift diagnostics are pure and can
live entirely in `@bgub/fig-data`. `readData(...)` cannot: it reads the active
render fiber, the active store, the work-in-progress dependency set, and commit
cleanup, all owned by the reconciler. Today the only bridge into those is
`RenderDispatcher` in `@bgub/fig`, which exposes the existing render reads
(`readContext`, `readPromise`) and nothing else.

So the split needs a real bridge, not just a package boundary, and the bridge —
not the public API — is the compatibility boundary that must be designed in
Phase 1. Two options:

- **Recommended:** add `readData`/`preloadData` as first-class
  `RenderDispatcher` methods in `@bgub/fig`, and have `@bgub/fig-data` call them
  through a thin, versioned store-bridge interface. They are render reads in the
  same family as `readContext`/`readPromise`, so they belong on the dispatcher;
  store, policy, and key logic stay in `@bgub/fig-data`.
- Publish a minimal, semver-stable `@bgub/fig/internal` store bridge (active
  store accessor, WIP dependency recording, commit subscribe/unsubscribe,
  generation tokens) that `@bgub/fig-data` consumes.

Shipping `@bgub/fig-data` first without a stable bridge just relocates semver
pressure onto `@bgub/fig/internal`, which is worse because internal churn is
unannounced.

### Server-Only Packaging

A runtime throw is not enough for server-only resources: a client bundle must
not include a server-only loader or its imports, or it can drag database
clients, secrets, and other server modules into the client graph even when the
runtime read would throw. Fig should support one of:

- split definition and loader APIs, where client code imports only the
  serializable key shape and server code attaches the loader, or
- a framework/compiler transform that replaces `dataResource.server(...)`
  loaders with client stubs before bundling.

The client stub must keep the `key` function so the client can compute the key
and find a hydrated entry; only the loader is stripped.

## Resource Definitions

```ts
interface DataResourceOptions<TArgs extends unknown[], TValue, TStoreContext> {
  key: (...args: TArgs) => readonly [string, ...DataResourceKeyInput[]];
  load: (
    ...argsAndContext: [...TArgs, DataResourceLoadContext<TStoreContext>]
  ) => TValue | Promise<TValue>;
  debugArgs?: (...args: TArgs) => DataResourceKeyInput;
  name?: string;
}

interface DataResourceLoadContext<TStoreContext = unknown> {
  signal: AbortSignal;
  /**
   * Store-scoped values supplied when the store is created: request auth,
   * headers, cookies, DB/session handles, framework context. Empty by default.
   */
  context: TStoreContext;
}
```

The `key`'s string head is the namespace that distinguishes definitions, and it
must be stable across server and client builds for any resource whose values are
streamed or hydrated (see Key Stability). The `name` option is diagnostics-only
and must not participate in identity.

The key function must be a lossless identity for every loader-relevant input. If
two raw argument lists normalize to the same key, Fig may coalesce them and run
one load using the first caller's args; that is correct only when the normalized
key fully captures the value the loader will produce.

### Load Context

`{ signal }` alone is too narrow for real server loaders, which need
request-scoped auth, headers, cookies, and DB or session handles. Reaching those
through module globals would undercut the "no global process caches by default"
goal by moving the loader's real inputs into ambient state.

So context belongs to the store, not the definition: whoever creates a store
(server request renderer, RSC response renderer, client root) supplies a
`context`, and Fig passes it to every loader run for that store. The definition
stays free of runtime handles and is reusable across stores. The definition is
typed by the context it expects; reading against a store whose context does not
satisfy that type is a type error. Context must not participate in key identity:
same args plus different contexts are the same key, and coalescing uses the first
caller's context.

### Key Input And Normalization

```ts
type DataResourceKeyInput =
  | string
  | number
  | boolean
  | null
  | readonly DataResourceKeyInput[]
  | { readonly [key: string]: DataResourceKeyInput };
```

A full key is `readonly [string, ...DataResourceKeyInput[]]`. Because normalized
keys become protocol identity, normalization is canonical:

- the first element must be a string namespace
- object keys sorted lexicographically; arrays preserve order
- valid scalars are strings, booleans, finite numbers, and `null`
- invalid: `NaN`, `Infinity`, `-Infinity`, `bigint`, symbols, functions, class
  instances, Dates, Maps, Sets, promises, and cycles
- `-0` normalizes to `0`
- `undefined` is invalid in arrays; an omitted property differs from a present
  `undefined` property, and present `undefined` properties are rejected

The normalized form must be stable across server and client runtimes — RSC
hydration, invalidation records, DevTools, and persisted stores share one
encoding.

### Drift Diagnostics

Key/argument drift can silently return the wrong data, so development builds run
a collision diagnostic without ever double-running loaders (which would create
side effects, extra network work, and divergent cancellation):

- each entry stores its canonical key and a development argument fingerprint
- the default fingerprint is the canonical encoding of the raw arg list when the
  args are serializable by the normalization rules; otherwise a resource can
  supply `debugArgs` to return a serializable fingerprint
- if a later read, preload, invalidation, or refresh hits the same canonical key
  with a different fingerprint while an entry exists, Fig warns with the
  namespace, canonical key, and both fingerprints
- when args cannot be fingerprinted and no `debugArgs` is given, Fig warns once
  per definition, only under a verbose diagnostics flag, so the common
  non-serializable-options case does not train users to ignore warnings

### Key Stability

Because the key is the identity and is serialized, a streamed value only
reattaches on the client when both builds produce the same key, including the
same namespace string. Key stability is therefore part of the protocol:

- development hydration diagnoses streamed entries whose namespace is not
  registered by any client resource
- a read/load of one key by two different resources warns (accidental namespace
  collision)
- lint rules flag namespace changes for cross-boundary resources
- persistent stores version entries by key-encoding version

This need not block a shared/client MVP, but the protocol should leave room for
it.

## Store Scopes

The same definition works with different store lifetimes.

**Server request store** (default for server rendering): repeated reads of a key
dedupe within one request; pending entries are shared across components;
fulfilled values are stable snapshots; rejected values are shared and re-thrown;
abandoned renders abort in-flight loaders; entries do not persist globally unless
a framework supplies a backing store. Similar in spirit to React's `cache(fn)`,
but keyed and explicit.

**Client root store** (default for client rendering): entries survive
re-renders; reads suspend when no usable value exists; entries track subscribing
fibers by key so imperative refresh/invalidation can schedule current readers;
the store garbage collects on root unmount, and fulfilled entries with zero
subscribers are retained for a short inactive window (for example five minutes),
then collected during idle work if no framework owner retained them. Long-lived
persistence, offline caches, broadcast sync, retries, and polling remain
library/framework concerns.

**RSC response store**: records which keys were read while producing a payload,
making that dependency set the basis for targeted refresh. If a server action
invalidates `["post", "42"]`, the framework can refresh the RSC output that read
that key rather than the whole route. Because keys are serializable, an RSC
payload can also hydrate client stores with server-read values; the hydrated key
is just the key, not the in-memory server object identity.

## Read Semantics

`readData(resource, ...args)`:

1. Resolves the active store from render context.
2. Normalizes the key.
3. Records the key on the work-in-progress fiber for reactive scheduling and
   refresh/dependency tracking.
4. Returns the fulfilled value if available, including stale or refreshing
   values.
5. If fulfilled but stale (and loader-backed), starts a background refresh if
   none is pending.
6. Throws the stored error if the entry is rejected with no usable fulfilled
   value.
7. On a cache miss, starts the loader, stores the pending entry, and suspends by
   throwing the pending thenable.

Outside render, `readData(...)` throws; preload and mutation APIs are the
imperative escape hatches. `preloadData(resource, ...args)` starts loading
without reading, and is valid during render, in event handlers, and in framework
preload hooks when a store is available.

### Strict Render And Load Initiation

Development strict shadow passes must not publish durable subscriptions but may
still touch the store. If a shadow-pass `readData(...)` or render-time
`preloadData(...)` misses, it creates the same entry the real pass would and
starts at most one load for that canonical key; the discarded pass records no
subscriber, but the pending entry and generation survive so the real pass dedupes
against the same thenable instead of issuing a second request. If the shadow pass
suspends, the retry reuses the same key and generation. This keeps strict-render
diagnostics from changing loader cardinality while preserving the rule that
subscriptions publish only at commit.

### Pending Load Ownership

Committed subscriptions answer "who re-renders when this key changes," but not
"who keeps a pending load alive and who may abort it" — a load can start before
anything commits, in a WIP render, a preload, or an abandoned Suspense attempt.
A pending entry tracks a set of retainers and aborts only when the set empties:

- **committed-subscriber**: added at commit when a fiber's published
  subscriptions include the key; removed when the fiber stops reading it or
  unmounts. The steady-state retainer.
- **render-attempt**: held by an in-progress render that read the key but has not
  committed. Released on commit (handing off to a committed-subscriber) or on
  abandonment — a load kept alive only by an abandoned attempt becomes eligible
  for abort.
- **preloader**: held by `preloadData(...)` until a read picks the load up or a
  short grace window elapses, letting preload run ahead of render.
- **framework**: held explicitly by a framework or library (route prefetch,
  persistent cache) that wants the entry to outlive renders.

Abort is generation-gated: when the last retainer for a generation is released,
the store aborts that generation's controller. A newer explicit refresh
increments the generation and supersedes older loads independent of retainer
accounting. The strict shadow pass adds no committed-subscriber but participates
as a render-attempt retainer of the shared generation, which is why it dedupes
rather than orphaning a second load.

### Store Resolution

Render reads resolve the active store through the current fiber and root, like
context reads. Imperative APIs need a store too:

- During render, they use the current render store.
- During Fig-managed root callbacks (delegated event handlers, `bind` callbacks,
  action dispatches, root-scoped transition callbacks), Fig installs the current
  root's store for the callback's duration.
- Outside a Fig-managed callback (timers, third-party subscriptions, module
  code), code binds the store explicitly with `root.data.run(fn)`.
- Server actions resolve to neither; they rely on a framework-installed
  action-local invalidation collector (see Server Actions).

So the standalone helpers work for the common event-handler case, while non-Fig
callbacks bind once — refresh and invalidation never depend on a global
process-wide "current root":

```ts
// In a Fig event handler: ambient store resolution.
<button events={[on("click", () => refreshData(userResource, id))]}>Refresh</button>

// Outside Fig: bind the store for the callback.
socket.on("user:update", (id) =>
  root.data.run(() => invalidateData(userResource, id))
);
```

`root.data` is a handle to one root's store; `root.data.run(fn)` installs it as
the current store for the duration of `fn` and returns `fn`'s result. Its
semantics are deliberately narrow:

- **Synchronous scope only.** `run` binds the current synchronous frame and
  restores the previous store when `fn` returns, like installing a render
  dispatcher rather than an `AsyncLocalStorage` context. The binding does not
  survive an `await`.
- **Throw on unbound, never guess.** An imperative helper called with no store in
  scope throws a "no resolvable store" error rather than falling back to a global
  or the most-recently-used store. Combined with sync-only scope, this turns the
  common mistake — an `await` inside `run` followed by a helper call — into a loud
  error instead of a silent cross-store leak.
- **Capture the handle for async, not the scope.** Code that must invalidate
  after awaiting should keep the handle and re-enter:

  ```ts
  const store = root.data;
  await save();
  store.run(() => refreshData(userResource, id));
  ```

`run` is the single binding path. Imperative helpers do not take a per-call store
argument, and the store exposes no parallel `store.invalidate(...)` verbs, so
there is one set of verbs whether resolution is ambient or explicit. Async-aware
binding (an `AsyncLocalStorage`-backed `run` that re-enters across awaits) is a
possible later addition if usage shows the sync rule is a frequent footgun; it is
not the default because it is a server-oriented cost on the critical path of
every client invalidation.

### Reactive Store Machinery

Data resources are reactive, unlike `readPromise(...)`. The store needs a
key-to-entry map, a key-to-subscribing-fibers map, WIP dependency sets for the
current pass, per-entry generation tokens and abort controllers, scheduling
hooks that mark subscribers on value/rejection/status change, the invalidation
policy hook, and commit hooks that publish WIP dependency sets as active
subscriptions and clean them up on unmount. This is structurally closer to
context consumer marking or `useExternalStore(...)` than to the passive thenable
cache behind `readPromise(...)`.

Subscription publication follows Fig's commit semantics:

- strict shadow passes and abandoned Suspense/error renders record no durable
  subscriptions
- current subscriptions stay active until a replacement render commits
- a committed render that stops reading a key removes it during commit
- unmount removes active subscriptions during commit
- adopted subtrees keep their subscriptions because they did not re-render

This avoids leaking dependencies from discarded work and avoids unsubscribing
visible UI before replacement work commits.

## Refresh And Invalidation

Fig exposes two revalidation verbs. They split cleanly along two axes that
happen to align, so each has a coherent role rather than overlapping:

|                                     | fetches when                          | returns                      | use                                                  |
| ----------------------------------- | ------------------------------------- | ---------------------------- | ---------------------------------------------------- |
| `invalidateData(resource, ...args)` | only if the key is currently observed | `void`                       | declarative "this is stale, update what's on screen" |
| `refreshData(resource, ...args)`    | always, now                           | `Promise<DataRefreshResult>` | imperative "reload and let me await it"              |

`invalidateData(...)` marks the key stale and schedules subscribed fibers on the
normal update lane, routed through the hidden-Activity lane downgrade so
hidden-only keys schedule offscreen. On re-render, `readData(...)` returns the
last fulfilled value and starts a background refresh if none is pending. With no
current subscribers it is a no-op beyond marking stale, so unobserved data is not
fetched until something reads it again. This matches the common expectation that
invalidating visible data updates the screen, without replacing visible content
with a Suspense fallback.

`refreshData(...)` starts a reload now regardless of subscribers, coalesces with
compatible in-flight loads, and returns a result. Fulfilled refreshes keep
returning the last value while loading and never throw a thenable or trigger
Suspense preservation. They cannot merge into one verb because declarative +
lazy-for-unobserved + fire-and-forget and imperative + always-fetch + awaitable
are genuinely different contracts: a single function cannot both skip unobserved
keys and hand back a meaningful result promise.

### `refreshData` Result

```ts
type DataRefreshResult<T> =
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; error: unknown; staleValue?: T }
  | {
      status: "aborted";
      reason: "superseded" | "store-disposed";
      staleValue?: T;
    }
  | { status: "unsupported"; reason: "no-client-loader"; staleValue?: T };

function refreshData<TArgs extends unknown[], TValue>(
  resource: DataResource<TArgs, TValue>,
  ...args: TArgs
): Promise<DataRefreshResult<TValue>>;
```

The promise resolves after the attempt this call joined or started and never
rejects, so handlers and actions avoid unhandled rejections. Loader errors
resolve to `rejected`. A newer explicit refresh resolving the joined callers
gives `aborted` with `"superseded"`; store disposal gives `aborted` with
`"store-disposed"`. A hydrate-only entry has no client loader, so the call
resolves to `unsupported` rather than a silent no-op — revalidating that key
requires an RSC dependency refresh. A framework adapter may expose a stricter
variant that throws.

### Suspense, Transitions, And Activity

Suspense is involved only when a read has no usable value: missing entries start
a load and suspend; rejected entries with no usable fulfilled value throw to
ErrorBoundary; fulfilled stale entries return the stale value (and may background
refresh); fulfilled refreshing entries return the last value.

Transitions affect scheduling and commit coordination: a refresh completing
inside a transition schedules subscribers at transition priority and swaps to the
new value without turning the old value into a fallback; a missing initial read
that suspends during a transition uses the existing Suspense preservation path.

Activity/offscreen state affects scheduling priority, not key identity. A refresh
publish schedules each subscriber through the same hidden-Activity lane downgrade
used for state updates, so a key read only by hidden subtrees schedules offscreen
work while a key read by both schedules visible subscribers at visible priority.
This deliberately differs from external-store subscriptions, which Fig _defers_
under hidden Activity (the commit walk stops descending into hidden boundaries).
Data-resource subscriptions are render dependencies, not side effects — the
record of which keys a committed fiber read — so they publish at commit even for a
hidden subtree, exactly like context consumer marking. A tree mounted hidden
still publishes its subscriptions, so later invalidation schedules offscreen work
correctly rather than silently missing the dependency.

### State Machine And Concurrency

```text
missing -> pending -> fulfilled
missing -> pending -> rejected
fulfilled -> refreshing -> fulfilled
fulfilled -> refreshing -> rejected
fulfilled -> stale
stale -> refreshing
rejected -> pending
```

If a refresh from a fulfilled value rejects, the default preserves the last
fulfilled value and stores the refresh error separately; reads expose the stale
value while DevTools, a store listener, or the refresh result surface the
failure. If the entry never fulfilled, rejection is the entry value and reads
throw. Concurrent refreshes coalesce per key when they target the same
generation; a newer explicit refresh supersedes older loads by incrementing the
generation, and older fulfill/reject callbacks must check the generation before
publishing so superseded results cannot overwrite newer data.

## Server Actions

Server actions should not implicitly know about application data; they need a way
to declare data-resource invalidations.

```ts
async function updateUserAction(id: string, patch: Patch) {
  await db.user.update(id, patch);
  invalidateData(userResource, id);
}
```

On the server there are no client fibers to schedule, so `invalidateData(...)`
just records invalidation intent. A server action runs in neither a render nor a
Fig-managed root callback, so it has no current store or `root.data` handle. It
therefore relies on a framework-installed **action-local invalidation
collector**: for the duration of the invocation, `invalidateData(...)` appends a
serializable record to the collector instead of touching a live store. When the
action returns, the framework drains the collector and chooses transport — fold
records into the RSC response, hand them to the router, or apply them to client
stores — and decides how to apply them (mark client entries stale, schedule
visible subscribers, or trigger an RSC dependency refresh). If the mutation
should update visible UI, the action path triggers a dependency refresh or
explicit `refreshData`.

If no collector is installed, calling these APIs in an action throws the same "no
resolvable store" error as any out-of-scope imperative call, rather than silently
no-op. A framework that prefers an explicit surface can instead inject an action
handle (for example `invalidations.add(resource, ...args)`) and skip ambient
resolution. Core Fig defines the invalidation record format and the collector
contract; frameworks decide transport.

## RSC Refresh Integration

Data resources are the primitive that makes RSC refresh precise. During RSC
rendering, Fig records which keys were read, which Suspense boundaries or model
segments depended on them, which fulfilled values were embedded, and which
pending reads produced streamed continuations. Refresh can then target:

- **key refresh**: reload one key
- **dependency refresh**: re-render RSC output that previously read one or more
  keys
- **root/framework refresh**: fallback for broad invalidation

The core protocol prioritizes key/dependency refresh; root refresh is a framework
convenience, not the foundation.

## Client Reads Of Server Data

A client-side `readData(serverOnlyResource, id)` is not automatically valid.
Three cases:

1. **Shared resource with a client-safe loader**: reads load directly.
2. **Server-only resource with a streamed value**: if the framework hydrated it
   into the store using the same key, reads consume it as a hydrate-only entry —
   readable, can go stale, but has no client loader, so stale reads do not
   background refresh and `refreshData(...)` returns `unsupported`. Revalidation
   is an RSC dependency refresh.
3. **Server-only resource without a streamed value**: the read throws a clear
   runtime error.

This avoids bundling database code while still allowing server data to hydrate
client stores, and depends on the packaging strategy above: client code imports
a serializable key stub for server-only resources, not the loader. If a Client
Component only needs a promise passed from a Server Component and not key-based
refresh, `readPromise(...)` is simpler.

## Cancellation

Loaders receive an `AbortSignal`. Server signals abort when the render request is
abandoned, a Suspense attempt is superseded such that the entry is unneeded, or
the request store lifetime ends. Client signals abort when a refresh is
superseded by a newer one for the same key, the root unmounts, or policy cancels
an unobserved pending entry. Aborted loads must not overwrite newer entries:
every load captures the entry generation at start and verifies it before
publishing.

## Error Handling

Initial read errors behave like promise read errors: pending entries suspend,
rejected entries throw to the nearest ErrorBoundary, and errors are keyed so
repeated reads see the same error until invalidated or refreshed.

Refresh errors differ because replacing visible UI with an error is jarring: if
the entry has a fulfilled value, Fig preserves it, stores the refresh error
separately, and notifies the caller or store; if it never fulfilled, the
rejection is the entry value and reads throw.

### Error Boundary Recovery

Keyed errors interact with Fig's sticky `ErrorBoundary`: after an initial load
rejects, resetting the boundary alone re-renders, reads the same rejected entry,
and throws again. Recovery must retry the key as well as reset the UI:

- boundaries record the data-resource keys that threw in their subtree
- a future boundary reset/retry API refreshes those keys before retrying
- until then, docs tell users to `refreshData(...)` or `invalidateData(...)` the
  failed key before remounting/changing the boundary key

The same client-side key dependency tracking used for refresh scheduling powers
this retry metadata.

## DevTools

Fig DevTools should eventually expose per-entry state: name, normalized key,
status, current owner roots/boundaries, last read time, pending/refreshing state,
invalidation source, and last error. Another reason to keep the terminology
precise.

## Implementation Phases

### Phase 1: Core Types And Store

- `dataResource` and `dataResource.client` definitions with required,
  string-headed keys.
- Canonical key normalization and dev diagnostics for invalid keys, namespace
  collisions, and key/argument drift fingerprints.
- The dispatcher/store-bridge layering contract: `readData`/`preloadData` on
  `RenderDispatcher` plus the versioned bridge `@bgub/fig-data` consumes.
- A flat request/root store with a store-scoped load context and enough
  backing-store seams that persistent caches can be added later without replacing
  the model.
- WIP dependency tracking plus commit-time subscription publication and cleanup.
- Per-entry generation tokens and abort controllers, plus the pending-load
  retainer model with generation-gated abort.
- `readData`, `preloadData`, `invalidateData`, `refreshData`, and
  `root.data.run`.
- Wire reads to Suspense and ErrorBoundary.
- Prove strict shadow passes dedupe load initiation without durable
  subscriptions.

### Phase 2: Transitions And Refresh Semantics

- Declarative `invalidateData` (lazy for unobserved keys) and eager `refreshData`
  defaults.
- Keep fulfilled stale/refreshing entries readable; refresh completion schedules
  subscribers at the appropriate priority; implement the `refreshData` result
  contract.
- Route hidden-only subscriber updates through offscreen scheduling, and prove
  data-resource subscriptions publish at commit even for trees mounted hidden.
- Tests for refresh success/failure, superseded refreshes, abort, and fulfilled
  refreshes not suspending.

### Phase 3: Server And RSC Tracking

- Track reads during server/RSC render.
- Hydrate streamed values into hydrate-only entries by key; ensure stale reads do
  not local-refresh and `refreshData` returns `unsupported`; route revalidation
  through RSC dependency refresh.
- Serialize invalidation/refresh metadata; targeted RSC refresh tests by key.

### Phase 4: Server-Only Packaging

- The first stable `dataResource.server(...)` strategy: split identity/loader
  APIs or a compiler/framework transform, keeping the `key` on the client stub.
- Dev diagnostics for streamed entries whose namespace is missing or drifted in
  the client build; lint/codegen guidance for key stability.

### Phase 5: Framework Adapter Hooks

- Store hooks for persistent caches, route integration, and server-action
  invalidation transport.
- The action-local invalidation collector contract (append serializable records,
  throw cleanly when none is installed).
- Keep these hooks separate from default core policy.

## Open Questions

- When, if ever, should the stable API move from `@bgub/fig-data` into
  `@bgub/fig`?
- Should the bridge be `RenderDispatcher` methods plus a versioned store bridge
  (recommended) or a published `@bgub/fig/internal` surface?
- What is the minimum store-context shape, and is it typed per resource or per
  store only?
- What is the exact action-local collector API, and does the standalone-helper
  convenience justify ambient resolution over an injected handle?
- Split identity/loader APIs or a compiler/framework transform for the first
  server-only packaging strategy?
- Should prefix invalidation (`["user"]`-prefix) be part of the core surface or a
  framework concern?
- What should the first ErrorBoundary retry/reset API look like for failed keys?
- What is the minimum RSC protocol change to map keys to refreshed payloads
  without overfitting to one framework?
