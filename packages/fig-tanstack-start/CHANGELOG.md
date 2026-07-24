## @bgub/fig-tanstack-start@0.1.0-alpha.1

### Refresh resolves the app's renderer runtime

`figRefresh` now imports `@bgub/fig-dom/refresh` through its bare specifier
rather than a resolved `/@fs/` path, so app-level aliases, dedupe, and
prebundling apply and the refresh scheduler cannot be instantiated twice.

### TanStack Start's client graph is prebundled

The TanStack Start adapter now prebundles `@tanstack/start-client-core` in
development while leaving its application-bound router and Start imports as
external Vite modules. This reduces the module-request waterfall without
freezing generated app entries or the linked Fig adapter packages. Production
continues to use Vite's normal application bundling.

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

### Promise-valued children render through Suspense

`FigNode` now accepts promises of nodes. Promise children occupy distinct,
host-transparent child slots, suspend through the nearest `Suspense`, and route
rejections or invalid resolved children through normal error handling.

HTML rendering retains exact promise children as independent streaming tasks,
while Payload uses node-validated promise rows that decode to the same child
shape. Payload-rendered async components are invoked once and retain their
component-scoped assets on the outlined row.

### Move HTML escaping helpers to a focused subpath

`escapeAttribute`, `escapeText`, `escapeScriptText`, and `escapeScriptJson` now export from
`@bgub/fig-server/html` instead of the main `@bgub/fig-server` entry.
The dedicated subpath keeps companion-markup helpers separate from server
render entry points while preserving their exact escaping behavior. The
TanStack Start adapter now consumes these helpers, Fig's internal data-store
brand predicate, and its own storage-context API instead of duplicating them.

### Expose render-discovered assets as response preload headers

Server stream results now provide a bounded, deduplicated HTTP `Link` value for
preconnects, fonts, stylesheets, explicit preloads, and module preloads
discovered before the shell becomes ready. Filters let adapters exclude asset
URLs that are unsafe for a shared cache.

The TanStack Start renderer can opt into merging that shell snapshot with the
response's existing `Link` header before constructing the streamed response.
Assets discovered after the shell continue to arrive through HTML streaming.

### Build generated TanStack Start file routes with Fig

`@bgub/fig-tanstack-router` now implements generated file routes, lazy route
records, lazy components, and lazy loader functions. TanStack Start builds and
reloads those routes in development through its existing generator and code
splitter.

`@bgub/fig-tanstack-start` now exposes Start configuration and middleware
factories. Its demo covers request-isolated middleware context, server and
client redirects, generated error and not-found routes, split chunks, SSR,
hydration, and server-function mutations.

### Complete Fig-native data and navigation patterns

TanStack Start routes can now preload Payload data and return immediately,
letting Fig Suspense stream the result and its asset resources without copying
values into Router loader data. Initial Payload responses registered after the
document shell starts are embedded before hydration, preventing a duplicate
client request.

The Router adapter adds modern object-only `useBlocker` and reactive
`useCanGoBack` hooks, makes the concrete Router and RouteApi constructors
internal, and rejects unsupported proximity preloading in `LinkProps`.
Fig's structural `ViewTransition` remains the sole document-transition owner,
even when a TanStack navigation carries its `viewTransition` option.

### Give each matched route ownership of its Fig assets

Route stylesheets, preload hints, preconnects, font preloads, and async scripts
now enter Fig's shared asset registry at the matched subtree. This gives Start
streaming, client navigation, and Payload assets one deduplicating ownership
model while title, meta, inline styles, JSON-LD, and synchronous scripts retain
their declared document positions.

Manifest `assetCrossOrigin` configuration now belongs to `createRouter`
options, where it is available before the root match renders.

### Fix first-load styling and development client navigation

Keep TanStack Start's compiler-sensitive client modules out of Vite dependency
prebundling so client navigation uses the client server-function transport
instead of executing server-only context access in the browser. Preserve
browser-extension roots appended to document singletons during hydration so a
third-party node cannot trigger document replacement and remove stylesheets.

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

### Own the TanStack Start document transport

`StartScripts` now owns Fig data serialization, the initial Payload insertion
point, and TanStack's bootstrap scripts as one ordered document surface. The
Payload transport targets a Fig-owned marker instead of matching TanStack's
private hydration-barrier markup.

The Vite adapter records its exact Router and Start core compatibility profile
and rejects emitted Solid Router or Start adapter modules. Server-only assets
are still mirrored into the public client output, but a conflicting client
asset now fails the build instead of being silently overwritten.

### TanStack Start gains state-preserving Fast Refresh

The TanStack Start Vite adapter now installs Fig Fast Refresh automatically.
Component edits update in place and preserve hook state in accepted modules.

`@bgub/fig-vite` is now a public package containing the reusable Fast Refresh
and server data-resource transforms.

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

### Build Fig applications with TanStack Start and Vite

`@bgub/fig-tanstack-start/plugin/vite` now delegates client and SSR builds,
development and preview serving, manifests, and server-function compilation to
TanStack Start's plugin core. Default entries stream and hydrate Fig documents
without application-owned build or HTTP glue.

The package root now exposes `createServerFn`. Compiled mutations use TanStack's
RPC transport and can invalidate the live Fig data store afterward; the demo
proves the full production flow from SSR hydration through mutation and one
data-resource refresh.

## @bgub/fig-tanstack-start@0.1.0-alpha.0 (alpha)

### Initial alpha release

First public alpha release of the TanStack Start adapter for Fig.

# Changelog
