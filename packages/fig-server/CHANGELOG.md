## @bgub/fig-server@0.1.0-alpha.1

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

### Publish metadata only with its visible owner

Title and meta resources now travel through Payload as owner-bound
declarations and update the document only when their decoded tree commits.
Pending or superseded refreshes keep the previous metadata visible.

Streaming HTML now treats Suspense fallbacks as metadata owners and reconciles
the completed visible metadata snapshot in the boundary reveal operation.
Partial segments and failed or abandoned primary work cannot mutate the head.

The obsolete `onAssetError` option and its asset-diagnostic types are removed:
late metadata is delivered with its owner instead of being dropped.

### `isValidElement` has a single home on the main entry

`isValidElement` was the one runtime export with two homes: the app-facing
main entry and `@bgub/fig/internal` (grouped with the other `$$typeof`
brand predicates). It is now exported only from `@bgub/fig`; the renderer
and server packages import it from there. The internal-only predicates
(`isSuspense`, `isPortal`, ...) are unchanged.

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

### Rename the payload decoding API to `createPayloadConsumer`

`createPayloadResponse` is now `createPayloadConsumer`, and the returned
object is a `PayloadConsumer` (options: `PayloadConsumerOptions`). The old
name described the object as a response when it is the long-lived decoding
end of the payload wire: it ingests many HTTP responses over its lifetime,
holds decode caches and boundary state, and re-renders a bound root.

The standalone `fetchPayload(response, input, options?)` function is now a
method: `consumer.fetch(input, options?)`. Behavior is unchanged — it sends
the consumer codec in `Accept`, sends `refreshBoundary` via
`PAYLOAD_BOUNDARY_HEADER`, rejects non-2xx with `PayloadFetchError`, and
resolves after the body is fully ingested.

Both changes are breaking renames with no compatibility aliases; migrate by
renaming call sites.

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

### `renderToPayloadStream` cancels through its signal only

The payload render result no longer carries an `abort()` method; it is
`{ stream, allReady, contentType }`. Cancellation is signal-only, matching
the payload decoder: pass `signal` in the render options (or cancel the
stream) to abort a hung payload render and reject `allReady`. The HTML
renderer keeps its `abort()` method, whose semantics are genuinely distinct
there (it delivers client-render ops for pending boundaries to a live
consumer); on the payload side it was a third spelling of the same
cancellation.

### Prioritize render-blocking document assets

Full-document rendering now emits parser- and security-sensitive metadata,
connection hints, critical font and image preloads, and stylesheets before
ordinary metadata and lower-priority JavaScript hints. TanStack Router matches
also register authored links and manifest stylesheets before their generated
module preloads, so render-blocking CSS begins loading earlier without changing
stylesheet order.

### Promise-valued children render through Suspense

`FigNode` now accepts promises of nodes. Promise children occupy distinct,
host-transparent child slots, suspend through the nearest `Suspense`, and route
rejections or invalid resolved children through normal error handling.

HTML rendering retains exact promise children as independent streaming tasks,
while Payload uses node-validated promise rows that decode to the same child
shape. Payload-rendered async components are invoked once and retain their
component-scoped assets on the outlined row.

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

### Batch server-rendered opening tags

Server HTML rendering now serializes each host opening tag and its attributes
into one segment chunk. Attribute-heavy trees avoid per-attribute segment and
flush-buffer entries while preserving byte-identical HTML output.

### Expose render-discovered assets as response preload headers

Server stream results now provide a bounded, deduplicated HTTP `Link` value for
preconnects, fonts, stylesheets, explicit preloads, and module preloads
discovered before the shell becomes ready. Filters let adapters exclude asset
URLs that are unsafe for a shared cache.

The TanStack Start renderer can opt into merging that shell snapshot with the
response's existing `Link` header before constructing the streamed response.
Assets discovered after the shell continue to arrive through HTML streaming.

### Streaming HTML and payload respect consumer backpressure

Server render streams — HTML and payload — now carry a byte-length queuing
strategy with a new `highWaterMark` option (default 65536 bytes). When the
stream's internal queue reaches the mark, completed Suspense content waits in
segment form (HTML) or encoded rows wait queued (payload) and flush through
the stream's pull handler as the consumer reads, so a slow connection no
longer buffers the entire remaining document in memory.
Rendering itself never pauses, and `shellReady`/`headReady`/`allReady` still
settle on task completion regardless of consumer pace. Gating sits between
boundary flushes, so every chunk still ends on complete markup. As a side
effect, boundaries that settle while the flow is blocked coalesce into a
single staged piece with one reveal op instead of partial fills.

Cancelling the stream mid-render (`reader.cancel()`) now aborts the render
cleanly instead of throwing from an enqueue into the cancelled stream.

### Compile Payload components and their assets

Fig TanStack Start now turns stylesheet imports in the ordinary component graph
reached from a `payloadResource` render callback into Payload asset dependencies
automatically. The same declaration compiles to a private TanStack server
function and Payload response, so applications no longer author
`createServerFn`, `renderPayloadResponse`, or request plumbing for Payload
routes. Payload rendering is independent of filenames. Applications
conventionally use `.payload.tsx` for the shared resource declaration, but the
suffix is only a human label. Components and assets referenced only by the
render callback are omitted from the browser bundle. Compiled styles use the
existing Payload row ownership, dedupe, streaming, and reveal-gating behavior
without requiring an `assets(stylesheet(...))` wrapper.

Applications mark the exceptional SSR-plus-hydration boundary with
`<Isomorphic component={Counter} ... />` and an ordinary static import. The
generated per-bundle manifest owns module resolution, stable component
identity, and client CSS metadata, so applications no longer author
`clientReference`, `createPayloadClientReferenceResolver`, ids, or dynamic
imports. Ordinary component uses remain Payload-rendered.

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

### Bound stalled view-transition waits

Transition-eligible commits and annotated streaming reveals now wait at most 60
seconds for a previous browser View Transition. If its completion promise never
settles, Fig releases the document mutex and proceeds with the latest work
instead of parking it forever.

## @bgub/fig-server@0.1.0-alpha.0 (alpha)

### Initial alpha release

First public alpha release of Fig.
