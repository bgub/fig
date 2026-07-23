# TanStack Router Adapter

Status: Start-first file-route contract; code-created routes supported for compatibility

`@bgub/fig-tanstack-router` connects TanStack Router Core to Fig. TanStack still owns route matching, loading, history, and navigation. Fig supplies components, hooks, native link behavior, and the reactive stores Router Core needs.

## What We Support

The adapter is built for TanStack Start's generated file routes, not exhaustive parity with every React adapter convenience.

- **Guaranteed:** generated and lazy routes, route hooks, router creation, providers, links, blockers, redirects, masks, errors, pending UI, SSR policies, hydration, route head/scripts, scroll restoration, and Fig data-resource delegation.
- **Compatible:** `createRootRoute` and `createRoute` for code-created trees. They use the same Router Core implementation but are not the preferred Start authoring style.
- **Deferred:** element scroll restoration, parent/child match helpers, custom link factories, and proximity preloading.
- **Deliberately omitted:** deprecated aliases and public copies of `Await`, `ClientOnly`, `CatchBoundary`, and `ScrollRestoration`. Fig's `readPromise`, Suspense, ErrorBoundary, hydration, and internal adapter behavior already own those jobs.

There is no `useLoaderData` when a Fig data store is configured. Route values live in one cache and components read them with `readData`.

Removing a convenience factory would not materially shrink the bundle because file and code routes share Router Core's implementation.

## Public Surface

The package exposes route factories, lazy helpers, masks, router creation, route APIs, provider and match components, head and script components, `Link`, `Navigate`, `Outlet`, data delegation, blockers, history helpers, and the normal router/location/match/params/search/context/navigation hooks.

Targeted hooks accept `{ from: routeId }` and may select a smaller value. Loose hooks accept `strict: false`, while match, params, and search reads may use `shouldThrow: false` for an inactive target. Selectors honor route structural-sharing options.

Route objects and `getRouteApi(id)` expose the same bound helpers: match, params, search, loader dependencies, route context, navigation, `Link`, and `notFound`. Bound helpers already know their route id and full path. Concrete `Router` and `RouteApi` constructors stay internal; callers use factories.

`createFileRoute` creates the uninitialized route that TanStack's generator later connects to a parent, id, path, children, and registered types. `createLazyFileRoute` supplies lazy options. `lazyRouteComponent` caches one import, exposes preload, and suspends with `readPromise`. `lazyFn` keeps Router Core's typed lazy-function contract.

The package targets its pinned Router Core version. Upgrading requires the generated-route, navigation, SSR, data, and document suites to pass. It publishes on npm because TanStack framework adapters require ambient module augmentation, which JSR source packages do not accept.

TanStack's generator currently knows only React, Solid, and Vue. The Start integration privately aliases its Solid target to Fig; no Solid runtime is involved. A native Fig target can later replace this build-time compatibility layer without changing route behavior.

## Reactive Store Graph

Router Core uses top-level atoms and per-match stores as its sources of truth. `router.state` is a compatibility snapshot derived from that graph.

The Fig adapter subscribes each feature to the smallest store available:

- `useLocation` and `Link` read the location atom.
- `Matches` reads the first-match id.
- `useMatches` reads the match list.
- Each rendered match reads its own store.
- Targeted hooks use Router Core's cached per-route store.
- Only `useRouterState` subscribes to the aggregate snapshot.

Browser routers use reactive TanStack Store atoms. Server routers use non-reactive stores because the server reads each value once.

## Navigation

`RouterProvider` merges supplied options and route context before rendering, so the first loader sees them. Later updates preserve context fields the provider does not replace.

In the browser, navigation begins inside a Fig transition. The previous route stays visible while the next route loads. If Router Core intentionally publishes pending UI after `pendingMs`, that commit is urgent. The adapter tracks the full async lifetime in `router.state.isTransitioning` and ignores completion from superseded navigation.

TanStack's document-level view-transition wrapper is disabled. Route animation belongs to Fig's structural `<ViewTransition>` boundaries; the two systems must not nest browser transitions.

A successful navigation reports lifecycle events in this order:

1. `onLoad`
2. `onBeforeRouteMount`
3. `onResolved`
4. `onRendered`, after the new subtree commits

History changes trigger loading and normalize the URL with replace when needed. A hydrated or already-populated router does not repeat its initial load. All subscriptions and transition overrides follow the provider lifetime.

`useBlocker` uses the modern object form. It may directly return a boolean/promise decision or, with `withResolver: true`, expose `proceed` and `reset`. `useCanGoBack` subscribes to Router's location index.

Ordinary navigation replaces the route tree. Retaining routes with Activity would require a separate keep-alive contract for state, effects, and data ownership.

## Rendering And SSR

Router Core owns match status and pending timers. A pending match reads Core's load promise through Suspense. `wrapInSuspense` selects route boundaries, and a root boundary protects initial client routing. Redirected matches suspend instead of rendering stale content.

Route errors reach route error components and `onCatch`. Resetting a route invalidates Fig data keys attributed to the caught error before Router reloads.

`remountDeps`, or `defaultRemountDeps`, supplies the route component key. A changed result resets component state; invalidation with the same result preserves it.

On the server:

- `ssr: false` skips the loader and component.
- `ssr: "data-only"` runs the loader but renders pending UI.

An internal hydration gate reveals those routes in the browser without exposing a separate `ClientOnly` component. Server error components render directly because Fig ErrorBoundary does not catch server-render failures.

Scroll restoration installs once and runs after `onRendered`. Start SSR emits one nonce-aware restoration bootstrap; there is no public restoration component.

## Route Assets

Each active match owns descriptors derived from route metadata and the Start manifest. An `assets()` boundary around the match delivers stylesheets, preloads, preconnects, fonts, and async scripts before dependent content. Fig's registry deduplicates them against assets from ordinary components and Payload.

`HeadContent` owns title, meta, JSON-LD, inline styles, and synchronous head scripts. `Scripts` owns synchronous body scripts and Start bootstrap output. Tags Fig cannot represent remain in their declared position with the private no-hoist marker.

`assetCrossOrigin` is a router option because route assets are translated before the document renders. The server nonce applies to both registry assets and positioned tags.

## Route Data

Applications place a `FigDataStoreHandle` at `router.context.data`. Router loaders then call:

```ts
await ensureRouteData(context, userResource, id);
```

The helper awaits `ensureData` and returns `void`. The component reads the same key with `readData`. Router decides when loading happens; Fig alone owns the value, identity, freshness, error, and hydration.

With a Fig store present, `createRouter` defaults `defaultPreloadStaleTime` to `0` unless the application supplied another value. A development diagnostic catches routes that also publish `loaderData`, which would create a second cache and wire format. Routers without `context.data` keep native Router Core loader behavior.

For non-blocking work, loaders call `context.data.preloadData` and return. Navigation may commit Suspense fallback UI while the component claims the entry. A superseding navigation can then remove that fallback without allowing the old result to publish.

## Links

`Link` always renders a native `<a href>`. Fig's `on()` mixin adds client navigation while preserving normal browser behavior for external URLs, reloads, downloads, modified clicks, non-primary buttons, and non-`_self` targets.

Disabled links omit `href` and set `aria-disabled`. Active and inactive props merge with the base anchor; `class`, `style`, `mix`, and `bind` compose rather than replace. Render-function children receive `isActive` and per-navigation `isTransitioning`.

Intent, render, and viewport preloading delegate to Router Core. Unsupported proximity preloading is rejected rather than silently ignored.
