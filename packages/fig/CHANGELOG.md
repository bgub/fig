## @bgub/fig@0.1.0-alpha.1

### Asset descriptors use native names and preserve native ordering

Client-inserted and host-rendered stylesheets now form precedence buckets in
the order each distinct precedence value is first discovered. A stylesheet
discovered later for an existing bucket is inserted before the following
bucket, keeping lazy and payload-delivered CSS in its intended cascade order.

Raw `<script>` elements now enter the asset registry only when explicitly
marked `async`. Non-async scripts retain their native document position and
execution semantics; explicit `script()` descriptors continue to support all
asset-delivery modes.

Asset descriptor options and serialized payload asset rows now use native HTML
attribute names: `crossorigin`, `fetchpriority`, and `http-equiv`. The previous
React-style `crossOrigin`, `fetchPriority`, and `httpEquiv` spellings are
removed.

Host resource resolution now receives the actual host parent and fixes
out-of-band placement once per fiber. SVG and MathML titles consequently stay
in their native namespace, while HTML titles carrying `itemprop` stay in-tree;
ordinary document titles continue to use the shared head registry.

### Drop the `clientReferenceAssets` helper from the main entry

The runtime helper `clientReferenceAssets(reference)` (read a client
reference's declared assets, resolving thunks) had two homes; it is now
exported only from `@bgub/fig/internal`, where its consumers — the payload
serializer and framework manifest plumbing — already import it. Apps
declare assets with `clientReference({ assets })` and never call the
helper. The `ClientReferenceAssets` type stays on the main entry because
it appears in the public `ClientReferenceOptions.assets` signature.

### Stable client-reference identity across decodes

`@bgub/fig/payload` exposes `createPayloadClientReferenceResolver(resolve)`:
a caller-owned stateful resolver passed as the `resolveClientReference`
decode option. With one, every resolvable client reference decodes to one
resolver-owned wrapper per reference id across all decodes sharing the
resolver — gated, ungated, or asynchronously resolved — so re-decoding a
payload updates islands in place instead of remounting them. Reveal gates
ride the decoded element instances rather than the wrapper: each decode
gates exactly its own content, so a newer decode's pending assets never
re-suspend an island already on screen, while its new island instances
still wait for the stylesheets they declared. The caller owns the
resolver's lifetime; under fast refresh no manual invalidation is needed
(hot edits remap the latched resolution through component families, and
unaccepted updates full-reload), while `delete`/`clear` cover manifest
swaps without a reload. With a plain resolve function, gated and async
references keep their per-decode wrapper identity, now with the same
per-element gating.

`@bgub/fig-dom`'s `payloadDataLoader` accepts the stateful resolver through
its existing `resolveClientReference` option.

Framework adapters can retain one resolver across refreshes and navigations,
preventing asset-gated islands from remounting on every re-decode.

### Publish metadata only with its visible owner

Title and meta resources now travel through Payload as owner-bound
declarations and update the document only when their decoded tree commits.
Pending or superseded refreshes keep the previous metadata visible.

Streaming HTML now treats Suspense fallbacks as metadata owners and reconciles
the completed visible metadata snapshot in the boundary reveal operation.
Partial segments and failed or abandoned primary work cannot mutate the head.

The obsolete `onAssetError` option and its asset-diagnostic types are removed:
late metadata is delivered with its owner instead of being dropped.

### Supersession abort waits for the successor's value

Refreshing a fulfilled data-resource entry no longer aborts the previous
generation's signal when the new load starts. Authority transfers when the
successor's value publishes: the visible stale value keeps streaming through
the refresh window (payload holes keep filling), subscribers re-render onto
the new tree in the same pass the old generation retires in, and a failed
refresh leaves the previous generation fully alive — stale value usable,
live holes included. Value-less pending loads still abort immediately when
superseded, and hydrate-over/eviction/disposal still end every generation.

This closes the gap where refreshing a serialized-component resource while
its holes were still streaming surfaced "Payload decode aborted." through
the nearest ErrorBoundary — cancellation now stays retirement, never a user
error, for plain consumers too.

### DevTools show per-fiber data-resource dependencies

`@bgub/fig` data stores expose `inspectDataDependencyCanonicalKeys(owner)`,
a dev-only inspection read of the canonical keys an owner's committed
`readData` subscriptions point at (returns an empty array in prod builds).

`@bgub/fig-reconciler` devtools snapshots record those keys on every fiber
as `FigDevtoolsFiberSnapshot.dataResourceCanonicalKeys`. The field is
required, so external snapshot producers must supply it (empty array when
unknown).

The `@bgub/fig-devtools` panel filters the Data section by the selected
fiber's dependencies instead of always listing the entire store, and tree
rows show a green badge with the fiber's data-resource read count next to
the blue hook-count badge. Selecting
the root still lists every entry, including those with no committed
subscriber (unclaimed preloads, hydrated-but-unread rows). Refreshing
entries no longer render a redundant `Pending` row.

### `ensureData`: the awaitable read for code outside render

`ensureData(resource, ...args)` resolves the value a key would render with:
the cached value when the entry has one (kicking the same background
revalidation a stale `readData` does), or the in-flight load's settlement on
a cache miss. It rejects with the error `readData` would throw, follows
superseding loads and server hydrations to the authoritative value, and never
subscribes — pair it with `readData` in the component, which claims the
settled entry within the preload retention window. An awaiting caller retains
the entry, so the unclaimed-preload eviction cannot abort a load out from
under an ensure.

Available as a free function (ambient store) and on the explicit handle
(`readDataStore()`, `root.data`). This is the delegation verb for external
routers: a route loader awaits `ensureData`, the component reads with
`readData`, and the data store stays the single cache.

### Serialized components move to the data-resource model

Serialized trees are now ordinary data resources: servers return plain
Payload streams, and clients consume them through keyed `dataResource`
instances with `payloadDataLoader`. Refresh is `refreshData`, navigation can
select a new key, and back/forward navigations reuse cached entries. Commits
wait for the incoming Payload, island modules, and stylesheet gates.

Supporting API additions: `payloadDataLoader` accepts a `prepareAssets`
override (defaults to `insertAssetResources`), and `decodePayloadStream`
accepts an `onClientReference` observer for reference metadata.

### Compose host behavior with mixins

Core now exports `createMixin()` and resolves render-time host behavior through
the `mix` prop. Mixins may contribute host props or nested mixins while keeping
the host type and subtree fixed. Explicit host props form the baseline; mixins
run in authoring order, and later results win.

DOM event listeners now use `mix={on(type, callback)}`. Migrate
`events={[on(type, callback)]}` to `mix={on(type, callback)}`; multiple or
conditional descriptors move into `mix={[...]}` and preserve positional
listener identity.

### Keep `useId` stable through selective hydration

`useId` now follows one canonical server/hydration tree path through Suspense
and Activity. Dehydrated boundaries snapshot that path when they claim their
server marker, then restore it when hydration resumes, so client updates that
insert or move surrounding siblings cannot renumber ids already present in the
server HTML. Suspense's private Activity wrapper is transparent to the path.

Components mounted only on the client now receive ids from a separate
`fig-C-*` namespace. Those ids remain stable for the component lifetime and
cannot collide with ids reserved by server-rendered content that has not
hydrated yet.

### `isValidElement` has a single home on the main entry

`isValidElement` was the one runtime export with two homes: the app-facing
main entry and `@bgub/fig/internal` (grouped with the other `$$typeof`
brand predicates). It is now exported only from `@bgub/fig`; the renderer
and server packages import it from there. The internal-only predicates
(`isSuspense`, `isPortal`, ...) are unchanged.

### Expose the payload decoder on JSR

The JSR manifest now exports `@bgub/fig/payload`, matching the npm package
and making the browser-safe payload decoder available from both registries.

### Payload exposes rendering and decoding, not its implementation

The payload packages now present two primary operations:
`renderToPayloadStream` on the server and `decodePayloadStream` in the
browser-safe core entry. Row/model types, value encoding, codec machinery,
content-type negotiation helpers, and framework document transports are
internal implementation details.

Client references use one `resolveClientReference(reference)` seam that may
return a component synchronously or asynchronously. It replaces the separate
load, resolve, and observation callbacks; reference metadata now includes its
stream-safe assets. The unused `load` field is also removed from
`clientReference(...)` declarations.

`payloadDataLoader` keeps only `request`, `resolveClientReference`, and the
optional `prepareAssets` override. Payload encoding is fixed internally rather
than exposed as a speculative custom-codec interface.

### Generation-lifetime loader signals and `payloadDataLoader`

Data-resource loader signals now live as long as their load's generation,
not just the pending promise: the `{ signal }` a loader receives stays
unaborted after the value lands and aborts when the generation loses
authority — a newer load supersedes it, a server push hydrates over it, the
entry evicts, or the store is disposed. A rejected load's own signal aborts
on settlement, and `invalidateData` never aborts (marking stale does not
revoke authority). Loaders that stream into their value in the background —
payload decodes filling holes — tie that work to the signal; plain fetch
loaders are unaffected.

The load context also carries an internal, generation-guarded hydration
capability (symbol-keyed; read through `@bgub/fig/internal`) that hydrates
server-pushed `data` rows through the calling store only while the load is
authoritative, skipping rows that target the loading entry's own key.

New in `@bgub/fig-dom`: `payloadDataLoader({ request,
resolveClientReference?, prepareAssets? })` adapts a payload-stream
endpoint into an ordinary data-resource loader. It validates the response
(status, body, payload codec content-type; unusable bodies are cancelled),
wires `decodePayloadStream` to the generation-lifetime signal, hydrates
`data` rows through the store capability, inserts stream-discovered assets
with `insertAssetResources` (stylesheet gates delay only dependent reveal),
and resolves with the decoded root value — so `readData(postResource, slug)`
suspends like any read and returns renderable elements while streamed holes
keep filling in the background.

### `@bgub/fig/payload`: the browser-safe payload home and `decodePayloadStream`

The payload decoder moved from `@bgub/fig-server/payload` to a new browser-safe
`@bgub/fig/payload` entry. Browser code no longer imports the server package to
decode; fig-server's serializer and the decoder share their private row/value
format through `@bgub/fig/internal`.

New client half: `decodePayloadStream(stream, options)` returns a live
`PayloadDecode` — `value` resolves when the root row decodes while outlined
holes keep streaming in, the never-rejecting `completion` reports
complete/failed/aborted, and `abort()` idempotently rejects unresolved holes
with an internal cancellation reason. Options wire data-row hydration
(`hydrate`), unified client-reference resolution, and asset preparation with
reveal gating (`prepareAssets`).

Internally, `assets` rows now carry an optional `for` — the row id whose
reveal depends on those assets, decided at serialization scope exit so a
suspended subtree's assets gate its outlined row rather than the enclosing
tree.

Dev-time enforcement: serialized components are render-only. During
`renderToPayloadStream`, `useState`, `useActionState`, `useTransition`,
`useStableEvent`, and the effect hooks now throw in development; the read
verbs, `useMemo`, `useId`, and `useSyncExternalStore`'s `getServerSnapshot`
path stay server-safe.

### Deliver client-reference assets outside the resolution suspension

A decoded client reference's asset declarations now attach above its
module-load and reveal-gate suspension points. A server document render
that hits a cold reference module emits the island's stylesheet with the
segment containing the reference instead of with the late fill, so
first-request asset ordering matches warm requests.

### Move `createPortalNode` to `@bgub/fig/internal`

`createPortalNode` is the cross-package seam renderers wrap in their
container-typed `createPortal`; apps never call it directly. It now lives
on the internal entry with the other renderer protocol exports instead of
the app-facing main entry. Portal-creating apps keep using
`createPortal(children, container, key?)` from `@bgub/fig-dom`; the
`FigPortal` type stays on the main entry because it appears in public
signatures.

### Promise-shaped payload decoder

`decodePayloadStream` now returns `Promise<FigNode>` directly — the root
value promise — instead of a `PayloadDecode` handle. Cancellation is
signal-only (`options.signal`, unchanged); the redundant `abort()` method is
gone. The `completion` promise is replaced by an `onStreamDone(result)`
decode option, called exactly once when ingestion settles as `complete`,
`failed`, or `aborted` — post-root failures that strand no pending hole
remain observable there. The callback is never awaited and its exceptions
and rejections are swallowed, so an observer — sync or async — cannot break
decode teardown or leak an unhandled rejection. The
`PayloadDecode` interface and its non-thenable caveat are deleted;
`PayloadDecodeCompletion` remains as the callback's result type.

`@bgub/fig-dom`'s `payloadDataLoader` migrates internally; its public API is
unchanged.

Also considered and declined: narrowing `ResolveClientReference` to an
opaque id. The reference's `exportName`/`ssr`/`assets` mirror the `client`
row's wire fields and are all load-bearing in framework document pipelines;
the rationale is recorded in `docs/concepts/payload.md`.

### Promise-valued children render through Suspense

`FigNode` now accepts promises of nodes. Promise children occupy distinct,
host-transparent child slots, suspend through the nearest `Suspense`, and route
rejections or invalid resolved children through normal error handling.

HTML rendering retains exact promise children as independent streaming tasks,
while Payload uses node-validated promise rows that decode to the same child
shape. Payload-rendered async components are invoked once and retain their
component-scoped assets on the outlined row.

### Tighten public component, loader, asset, and bind signatures

`@bgub/fig` now names the shared data loader contract as
`DataResourceLoader`, constrains lazy loaders to components, and exposes
`ComponentProps` so lazy wrappers preserve the loaded component's props
without exposing its implementation statics. Client-reference SSR
implementations stay aligned with the reference's props. Stable-event typing
now models the trailing lifecycle signal separately from caller arguments.

`meta()` descriptors now require exactly one valid metadata identity:
`charset`, `name` plus `content`, `property` plus `content`, or `http-equiv`
plus `content`. Raw meta elements that do not satisfy the same shape remain
ordinary host elements instead of entering the asset registry.

`@bgub/fig-dom` payload requests now receive the standard
`DataResourceLoadContext`, portals retain their DOM container type in the
returned `FigPortal`, and bind callbacks must return `undefined`; cleanup is
exclusively driven by their `AbortSignal`.

### Attribute rejected payload holes to their data resource

Payload hole errors are attributed to the authoritative owning data-resource
generation. Error boundaries receive `dataResourceKeys`, and
`invalidateDataError` retires the broken fulfilled value before retrying so a
remounted boundary suspends on fresh content instead of immediately catching
the same rejected hole. `decodePayloadStream` also exposes an observational
`onHoleError` callback.

The load context's hydration capability now shares the same authority window:
a still-visible generation's `data` rows keep hydrating through a superseding
refresh's window instead of being dropped the moment the refresh starts.

### Remove the `FigText` type alias

`FigText` was a two-member alias (`string | number`) whose only use was
as a constituent of the `FigNode` union; no signature anywhere took it
by name. The union now spells out `string | number` directly, and the
alias is gone from both the main and internal entries. Code that
referenced `FigText` should use `string | number` (or `FigNode` where
the full children type is meant).

### Remove the `h` alias for `createElement`

`@bgub/fig` no longer exports `createElement` under the second name `h`.
Every export has one home and one name; migrate by importing
`createElement` (or alias it locally: `const h = createElement`).

### Use one data-resource API in every environment

`dataResource` now covers shared, browser, and server-only loaders without a
second API. Server-only loaders belong behind the framework's server module
boundary; browser code uses an explicit key-only resource when it needs the
same hydrated value.

The pass-through `serverDataResource` API, `@bgub/fig/server` entry point,
`figData` Vite transform, and generated browser resource stubs are removed.

### The targeted-refresh protocol and payload consumer are gone

The serialized-components deletion gate passed across the demo e2e suites,
so the legacy architecture is removed rather than deprecated:

- `@bgub/fig-server/payload` no longer exports `createPayloadConsumer`,
  `PayloadConsumer`, `PayloadBoundary`, `PAYLOAD_BOUNDARY_HEADER`,
  `PayloadFetchError`, or the consumer fetch/ingestion seam, and
  `renderToPayloadStream` drops its `refreshBoundary` option.
- The wire format loses the `refresh`/`refresh-error` rows and the
  `$fig:"boundary"` model: the refresh unit is the data-resource key that
  delivers the payload, so refreshing is requesting the same stream again.

Replacements, all already shipping: `decodePayloadStream` in
`@bgub/fig/payload` is the client half; fig-dom's `payloadDataLoader`
delivers a serialized tree as an ordinary data resource; the freshness
verbs (`refreshData`/`invalidateData`) are the refresh story; sub-tree
refresh granularity is finer resource keys.

### Move HTML escaping helpers to a focused subpath

`escapeAttribute`, `escapeText`, `escapeScriptText`, and `escapeScriptJson` now export from
`@bgub/fig-server/html` instead of the main `@bgub/fig-server` entry.
The dedicated subpath keeps companion-markup helpers separate from server
render entry points while preserving their exact escaping behavior. The
TanStack Start adapter now consumes these helpers, Fig's internal data-store
brand predicate, and its own storage-context API instead of duplicating them.

### Server-route navigations commit content in one pass

Navigating to a payload server route used to commit an empty slot for one
retry beat (stretched to the full animation length when a view transition
was running) before the content revealed, because three already-settled
promises still suspended on their first render read:

- payload element gates are now tracked at creation, so a gate that settles
  before its first read resolves synchronously;
- client-reference module resolutions are tracked the same way;
- pre-commit asset preparation now reveals the island hydration gate,
  so navigations mount real islands instead of paying a placeholder →
  reveal follow-up commit.

The route swap now lands as a single commit containing the full decoded
content, so view transitions capture the destination page with its content
already present.

### Resolved client references keep their identity across decodes

`decodePayloadStream` used to wrap every client reference in a fresh
per-decode component, so re-decoding a surrounding payload (refreshing a
server component that contains islands) remounted every island and dropped
its client state.

References that `resolveClientReference` resolves synchronously and that carry no asset
gate now decode to the resolved component itself. The element type is
identity-stable across decodes, so a refresh of the surrounding payload
updates islands in place and their state survives. Gated or
asynchronously resolved references still decode to per-decode wrappers.

### Preserve framework-managed asset placement

Framework adapters can now keep externally managed head and body tags in their
declared positions without exposing a DOM prop. TanStack Router uses this for
route-managed links, styles, and scripts while continuing to map title and meta
entries through Fig asset resources. Full-document hydration now ignores the
doctype and one shared marker identifies every server-owned node without a
client fiber. Declarative asset lists also gain a client commit lifecycle, so
route titles and metadata update during navigation.

### Add Payload routes to the TanStack Start adapter

`@bgub/fig-tanstack-start/payload` now exposes `payloadResource`, which compiles
an inline render callback into a private server function and Fig-owned route
data resource. Applications supply the cache key and component tree without
authoring transport plumbing. The shared declaration can stay in one
`.payload.tsx` module; its render callback and render-only imports are omitted
from the browser build. The initial SSR response is embedded into the document
and adopted without refetching; client navigation and refresh use the same
resource request path. Payload data rows
hydrate the shared store, asset resources are retained on their owning server
segments or inserted through the browser registry, and client references retain
their resolver-defined identity. `decodePayloadStream` and `payloadDataLoader`
now expose `retainAssets` for server document renderers that need this delivery
path.

`@bgub/fig-tanstack-start/server` exposes the lower-level
`renderPayloadResponse` used by the generated TanStack server function; it
defaults its render abort signal to the incoming request, so a disconnected
client cancels the Payload render. Shell
HTML streams while outlined Suspense holes settle, and the completed initial
responses are embedded before TanStack starts full-document hydration. The Vite
adapter also publishes assets imported only by server modules into the client
build output. Fig Router links also consume TanStack's `viewTransition`
navigation option without forwarding it as an invalid attribute to the rendered
anchor, and derive active state from the resolved route instead of an in-flight
location.

### Add the TanStack Start runtime adapter

`createDataStore` now creates a root-neutral Fig store that route loaders can
populate before a renderer exists. Server and client renderers adopt that exact
store, preserving one cache while attaching their lifecycle and scheduling.

The new TanStack Start runtime uses the store for route loading, server
rendering, Fig-owned document serialization, client deserialization, and
hydration. Route-managed head and script output maps through the Router adapter,
including Fig asset resources. The end-to-end contract verifies no initial
client refetch and exactly one reload after invalidation.

### Share the text-separator protocol constant; small DOM cleanups

The `<!--,-->` text-separator comment the server writes between adjacent text
fibers was hardcoded independently by the server renderer and fig-dom's
hydration cursor. The comment data now lives in `@bgub/fig/internal` as
`TEXT_SEPARATOR_DATA`, next to the other streaming protocol constants, so the
two sides cannot drift. No wire change — the emitted markup is identical.

fig-dom also drops an unused internal `rootFor` helper, routes style clearing
through the shared `isEmptyPropValue` predicate, and simplifies a redundant
branch in select-value syncing. No behavior change.

### Add typed View Transition scopes and abortable lifecycle events

`transition` and the `useTransition` starter now accept explicit transition
types, which Fig carries with the updates that reach each root and forwards to
the browser without leaking into unrelated commits.

`ViewTransition` adds one `onTransition(event, signal)` lifecycle callback for
enter, exit, share, and update phases. Events expose all participating surfaces
and the commit's transition types. Fig DOM's optional View Transition entry can
resolve those opaque surfaces into group, image-pair, old, and new pseudo
handles for animation and inspection; the signal aborts when the native
transition finishes.

### Bound stalled view-transition waits

Transition-eligible commits and annotated streaming reveals now wait at most 60
seconds for a previous browser View Transition. If its completion promise never
settles, Fig releases the document mutex and proceeds with the latest work
instead of parking it forever.

## @bgub/fig@0.1.0-alpha.0 (alpha)

### Initial alpha release

First public alpha release of Fig.

# Changelog
