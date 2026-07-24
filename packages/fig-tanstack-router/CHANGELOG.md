## @bgub/fig-tanstack-router@0.1.0-alpha.1

### Add the TanStack Router adapter for Fig

`@bgub/fig-tanstack-router` now supplies code-route creation, a Fig router
provider and outlet, router hooks, native anchor links, route preloading, and a
private reactive-store bridge for `@tanstack/router-core` 1.171.15.

### Prioritize render-blocking document assets

Full-document rendering now emits parser- and security-sensitive metadata,
connection hints, critical font and image preloads, and stylesheets before
ordinary metadata and lower-priority JavaScript hints. TanStack Router matches
also register authored links and manifest stylesheets before their generated
module preloads, so render-blocking CSS begins loading earlier without changing
stylesheet order.

### Remove `useLoaderData`; enforce void loaders for data-backed routers

The adapter no longer exposes `useLoaderData` (standalone, route-bound, or via
`getRouteApi`): the Fig data store is the single route-data cache, so loader
values are read with `readData` against the same resource the loader ensured.
`useLoaderDeps` remains — deps are loader orchestration, not a cache.

In dev builds, a match that commits with `loaderData` set while
`router.context.data` is configured now throws a diagnostic naming the route.
Derive navigation-scoped values from `useLoaderDeps`, search params, or
`beforeLoad`-returned route context. Routers created without `context.data`
keep Router Core's native loader semantics untouched.

### Build generated TanStack Start file routes with Fig

`@bgub/fig-tanstack-router` now implements generated file routes, lazy route
records, lazy components, and lazy loader functions. TanStack Start builds and
reloads those routes in development through its existing generator and code
splitter.

`@bgub/fig-tanstack-start` now exposes Start configuration and middleware
factories. Its demo covers request-isolated middleware context, server and
client redirects, generated error and not-found routes, split chunks, SSR,
hydration, and server-function mutations.

### Add canonical bound route APIs

Fig routes and `getRouteApi` now provide bound match, params, search,
loader-deps, loader-data, context, navigation, link, and not-found helpers. The
adapter also adds active-match selection, reactive route matching,
`MatchRoute`, and declarative `Navigate` APIs.

### Expand TanStack Router hook and link parity

Router selectors now honor structural sharing, including the router-wide
default, and support selected locations plus loose or optional match reads.
Links gain composable active and inactive props and render-function children
with active and transitioning state. `linkOptions` and `createRouteMask` add
zero-wrapper helpers for reusable, type-checked navigation options. A
published compatibility matrix now distinguishes the guaranteed Start surface
from compatibility, deferred, and deliberately omitted APIs.

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

### Make data resources the router's default external cache

Put `root.data` in router context, return `ensureRouteData` from loaders, and
read the same resource with `readData` in components. Data-backed routers now
default `defaultPreloadStaleTime` to `0`, the loader helper resolves to `void`
so the value is not duplicated in `loaderData`, and route reset invalidates
attributed Fig data errors before re-running the router. The adapter also
renders Router Core's global not-found state through the root outlet.

### Complete route match rendering semantics

Route matches now honor pending delay and minimum duration, route and default
remount dependencies, explicit Suspense wrapping, client-only and data-only SSR
policies, redirects, and router-level error reporting. Scroll restoration is
installed idempotently and emits its Start SSR bootstrap once.

### Keep outgoing route hooks valid through unmount

Route-scoped hooks now retain their mounted match while navigation replaces the
active match list. Outgoing routes can subscribe to router state without
throwing during browser back navigation and clearing the rendered page.

### Settle Router navigation through Fig transitions

`RouterProvider` now merges partial options and route context before the first
loader runs. Browser navigation uses Fig transitions, publishes Router's load,
mount, resolved, and rendered lifecycle events in order, ignores superseded
navigation completions, and keeps `isTransitioning` accurate while an
asynchronous navigation settles.

Hydration skips duplicate initial loads, canonical validated locations replace
the browser URL, and provider unmounts release history and transition bindings.

### Give each matched route ownership of its Fig assets

Route stylesheets, preload hints, preconnects, font preloads, and async scripts
now enter Fig's shared asset registry at the matched subtree. This gives Start
streaming, client navigation, and Payload assets one deduplicating ownership
model while title, meta, inline styles, JSON-LD, and synchronous scripts retain
their declared document positions.

Manifest `assetCrossOrigin` configuration now belongs to `createRouter`
options, where it is available before the root match renders.

### Define the Start-first Router support contract

The Router adapter now documents generated TanStack Start file routes as its
primary interface, distinguishes supported code-created routes from deferred
or deliberately omitted adapter conveniences, and clarifies when route data
belongs in Fig data resources versus Router `loaderData`. The package also
declares itself side-effect-free and guards the production Start-oriented
surface with a bundle-size limit.

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

## @bgub/fig-tanstack-router@0.1.0-alpha.0 (alpha)

### Initial alpha release

First public alpha release of the TanStack Router adapter for Fig.

# Changelog
