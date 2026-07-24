## @bgub/fig-dom@0.1.0-alpha.1

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

### Restore shadowed document metadata when its winner leaves

Client title and meta entries now keep stable per-fiber ownership claims. The
latest acquired live claim controls the single canonical DOM element; updates
to shadowed claims stay dormant, and removing the winner immediately restores
the latest remaining value.

Hoisted host and declarative asset lifecycle callbacks receive an opaque,
stable `AssetResourceOwner`. Hoisted updates own the complete canonical host
update, including text, so a shadowed fiber cannot overwrite registry state.

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

### Recover full-document Suspense hydration mismatches

Full-document hydration now escalates a mismatch inside the document-level
Suspense boundary to root recovery, preserves the document doctype, and
rebuilds the document without reusing cleared insertion anchors.

### Make `configureDomRefreshScheduler` internal

The `@bgub/fig-dom/refresh` subpath now exports only `scheduleRefresh`
and the `RefreshFamily`/`RefreshUpdate` types. The wiring setter was
called by exactly one place — fig-dom's own renderer, as a module side
effect — and HMR runtimes only ever needed `scheduleRefresh`. The
before-main-entry update buffering is unchanged and keeps living in a
single shared module, so pre-evaluation refreshes still replay once the
renderer configures itself.

### Split fig-dom's oversized modules into focused ones

Internal restructuring with no API or behavior change. The host config and
renderer wiring move out of the package entry into `renderer.ts`; form
control value/checked/select handling, style application, the `on()` event
descriptor, and the propagation-state patching each get their own module.
Event slot attachment state is now a discriminated union instead of four
nullable fields.

### Serialized components move to the data-resource model

Serialized trees are now ordinary data resources: servers return plain
Payload streams, and clients consume them through keyed `dataResource`
instances with `payloadDataLoader`. Refresh is `refreshData`, navigation can
select a new key, and back/forward navigations reuse cached entries. Commits
wait for the incoming Payload, island modules, and stylesheet gates.

Supporting API additions: `payloadDataLoader` accepts a `prepareAssets`
override (defaults to `insertAssetResources`), and `decodePayloadStream`
accepts an `onClientReference` observer for reference metadata.

### Diagnose hoisted resource declassification

Development now throws when an update would turn a permanently hoisted host
fiber into an ordinary in-tree element, naming the affected asset and
explaining that changing placement requires a different Fig element key.
Production ignores the update instead of mutating a shared delivery asset or
overwriting the owner's last valid title or metadata claim.

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

### Trim DOM renderer hot-path work

The DOM renderer now avoids transient collections while diffing host props,
updating event descriptors, and scanning document assets. Event routing keeps
root state in one container record, stores less per-listener metadata, and
builds dispatch paths in place. Host configuration callbacks whose signatures
already match now connect directly instead of paying forwarding closures.

Controlled single-select elements also keep their scalar value without
allocating a one-entry `Set`; multi-select values retain set lookup behavior.
These changes preserve the public API while reducing the production entry
bundle and allocation pressure during mount, update, dispatch, and teardown.

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

### Make DOM View Transitions explicitly optional

`enableViewTransitions()` from `@bgub/fig-dom/view-transitions` explicitly
activates native DOM View Transitions, including after roots exist. Applications
that omit the optional entry exclude both the reconciler planner and browser
adapter from their bundles.

Renderer authors can install the optional View Transition planner through the
new single-owner commit-coordinator seam. Coordinator types preserve the host's
container and instance identities, while a private type-only contract keeps the
planner's fiber and root views aligned with the reconciler.

### Make Payload trees directly renderable

`createPayloadComponent` now creates a props-typed component backed by Fig's
ordinary data store. Complete props form its cache identity by default through
a canonical encoding of Payload-compatible values, and the component works
with route loaders and the existing data-resource freshness APIs and explicit
store handles.

The lower-level `payloadDataLoader` and `PayloadDataLoaderOptions` exports have
been removed. Use `createPayloadComponent`, or `decodePayloadStream` when
managing the transport and data integration directly.

TanStack Start replaces `payloadResource({ key, render })` with
`createPayloadComponent({ key, load: serverPayload(render) })`. Its compiler
can extract a component imported from `.server.tsx`, while initial companion
streams, client references, and compiled asset dependencies keep their existing
transport behavior.

Payload component loaders receive the resolved resource `key` alongside
`signal`, so framework transports can register responses under the exact cache
entry without changing ordinary data loaders.

Default keys are canonical across plain-object property order, and Payload
components use their namespace as their DevTools label. TanStack Start renders
the supplied component inside the Payload renderer so root-level reads and
suspension work, and rejects uncompiled `serverPayload` calls before invoking
application code.

Payload rendering also rejects nesting one Payload component inside another in
development. Payload components are client-visible delivery boundaries;
compose ordinary server components inside them or mount separate Payload
components from the client tree to preserve independent refresh keys.

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

### Move `act` to `@bgub/fig-reconciler/test-utils`

`act` is testing infrastructure, not renderer construction, so it moves
off the main entry onto a `./test-utils` subpath — the same shape as
`@bgub/fig-dom/test-utils`. DOM tests keep importing `act` from
`@bgub/fig-dom/test-utils`; renderer tests now import it from
`@bgub/fig-reconciler/test-utils`. Behavior is unchanged; the subpath
shares the scheduler instance with the main entry.

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

### Fix first-load styling and development client navigation

Keep TanStack Start's compiler-sensitive client modules out of Vite dependency
prebundling so client navigation uses the client server-function transport
instead of executing server-only context access in the browser. Preserve
browser-extension roots appended to document singletons during hydration so a
third-party node cannot trigger document replacement and remove stylesheets.

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

## @bgub/fig-dom@0.1.0-alpha.0 (alpha)

### Initial alpha release

First public alpha release of Fig.

# Changelog
