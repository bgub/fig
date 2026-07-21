# TanStack Router Adapter

Status: Start-first file-route contract; code-created routes supported for compatibility

`@bgub/fig-tanstack-router` adapts `@tanstack/router-core` to Fig without forking TanStack's route matching, loading, history, or navigation contracts. The package owns only the framework seam: Fig components and hooks, native DOM link behavior, and the reactive store factory supplied to `RouterCore`.

## Support Policy

The adapter is designed for TanStack Start's generated file routes rather than exhaustive parity with the React adapter. Its interface is divided into explicit tiers:

- **Guaranteed:** generated file and lazy routes; the generated-tree mutation and type-registration contract; route-bound and targeted hooks; router creation and provision; native links and navigation; loaders, redirects, not-found and route errors; ordinary Start SSR and hydration; route head/script output; search and history helpers; and Fig data-resource delegation.
- **Compatibility:** `createRootRoute` and `createRoute` remain supported for code-created route trees. They share Router Core's route implementation with generated routes, so removing their factories would simplify the name list without materially shrinking the runtime. They are not the recommended Start authoring path.
- **Deferred:** advanced SSR modes, pending-delay/minimum and remount semantics, scroll-restoration integration, blockers and back-navigation hooks, element-scroll helpers, parent/child match selectors, and uncommon link conveniences such as proximity preloading. A Router Core type is not a promise that every framework-adapter convenience exists.
- **Deliberately omitted:** additional deprecated compatibility classes and aliases, plus public clones of `Await`, `ClientOnly`, `CatchBoundary`, and `ScrollRestoration`. Fig's `readPromise`, `Suspense`, `ErrorBoundary`, renderer lifecycle, and internal adapter behavior own those concerns. Ordinary navigation does not use `Activity`; retaining inactive route trees would be a separate keep-alive contract with different state and effect lifetimes.

This policy is a compatibility boundary, not a bundle-size mechanism. File and code routes share `BaseRoute`, runtime route-tree processing, match loading, and `RouterCore`; the Start-shaped bundle is therefore governed primarily by Router Core rather than the number of factories re-exported by Fig.

## Initial Surface

The adapter surface consists of `createRootRoute`, `createRootRouteWithContext`, `createRoute`, `createFileRoute`, `createLazyFileRoute`, `lazyRouteComponent`, `lazyFn`, `createRouter`, `getRouteApi`, `RouterProvider`, `Matches`, `MatchRoute`, `Navigate`, `Outlet`, `HeadContent`, `Scripts`, `Link`, `ensureRouteData`, and the router, location, match-list, match-route, match, params, search, loader-deps, loader-data, route-context, and navigation hooks. Targeted hooks accept `{ from: routeId }` and an optional selector to subscribe directly to a specific active match and infer its value from the registered tree.

Route objects, root-route objects, and `RouteApi` expose the canonical bound interface: `useMatch`, `useParams`, `useSearch`, `useLoaderDeps`, `useLoaderData`, `useRouteContext`, `useNavigate`, `Link`, and `notFound`. Bound hooks close over the route id; navigation and links close over its full path. `getRouteApi(id)` resolves the full path from the registered router at render time, so code outside a route module gets the same interface without retaining a route instance. Generated-tree transforms preserve the interface through Router Core's `RouteExtensions` seam.

`createFileRoute` creates an uninitialized non-root `BaseRoute`; TanStack's generated tree supplies its parent, id, and path with `update`, then attaches generated children and file types. `createLazyFileRoute` returns the lazy option record Router Core merges into that route. `lazyRouteComponent` caches one dynamic import, exposes its preload function, and suspends through Fig's `readPromise` until the selected component export resolves. `lazyFn` is Router Core's typed lazy function loader.

The current generator accepts only React, Solid, and Vue targets and hard-codes the corresponding constructor import during route-file normalization. The Start plugin therefore uses the Solid package ID as a build-time alias to Fig; no Solid runtime participates. A native framework target removes that source-level compatibility ID but does not change the route object or rendering contracts.

The conformance target is `@tanstack/router-core@1.171.15`, pinned in the package that implements and tests the adapter. Moving the pin requires the generated-route, navigation, SSR, data, and document suites to pass against the new version. TanStack's store is an implementation detail: it supplies the dependency graph for Router's atoms and derived stores but is not re-exported as a Fig Store API. The package publishes on npm rather than JSR because TanStack framework adapters require ambient augmentation of `@tanstack/router-core`, which JSR does not accept in source-native packages.

## Signal Graph

The adapter follows Router Core's [signal-graph architecture](https://tanstack.com/blog/tanstack-router-signal-graph): top-level atoms and per-match stores are the sources of truth, while `router.state` is the compatibility snapshot derived from them. Browser routers supply TanStack Store atoms for mutable and derived stores; server routers use Core's non-reactive stores because a server render reads each value once.

Framework internals subscribe to the narrowest available store. `useLocation` and `Link` read the location atom, `Matches` reads the derived first-match ID, `useMatches` reads the match-list store, `useMatchRoute` reads the match-route dependency store, each rendered match reads its own match store, and targeted or route-bound hooks use Core's LRU-cached per-route store. Only the public `useRouterState` compatibility hook subscribes to the aggregate `router.state` store. This topology is an implementation contract rather than an additional application-facing API.

`Navigate` runs after commit through Fig's before-paint lifecycle. It compares navigation option values rather than props-object identity, preventing a still-active redirect route from restarting the same navigation when Router state changes during loading.

## Navigation Lifecycle

`RouterProvider` accepts partial router options and a partial route context. It merges both with the router's existing options before rendering the match tree, so an initial loader observes provider context without waiting for a later commit. A provider update preserves context fields it does not replace.

In the browser, the provider installs a Fig transition at Router Core's `startTransition` seam. The outer asynchronous navigation owns the transition; Core's nested synchronous transition callbacks join it. The adapter keeps the previously resolved match tree visible while the navigation settles, sets `router.state.isTransitioning` for that asynchronous lifetime, and ignores completion from a superseded navigation. Unmount restores the router's previous transition function and invalidates any outstanding completion.

For a successful navigation, framework lifecycle events have this order:

1. `onLoad` after route loading finishes.
2. `onBeforeRouteMount` after loading and pending matches finish, immediately before the resolved route is published.
3. `onResolved` when the router becomes idle and `resolvedLocation` advances.
4. `onRendered` after the newly resolved match subtree commits.

History changes start route loading and normalize the browser URL to Router Core's canonical validated location with a replace operation. A hydrated router, or a router whose match list is already populated, does not start a duplicate initial load. History subscriptions and transition overrides are scoped to the provider lifetime.

Ordinary navigation replaces the visible match tree after the transition resolves; it does not retain the prior tree through `Activity`. Activity-based keep-alive routing would need an explicit contract for retained route state, effects, and data ownership and remains deliberately omitted.

## Route Data Contract

Fig data resources are the default external cache for route data. Applications place the root's `FigDataStoreHandle` at `router.context.data`; its presence makes `createRouter` default `defaultPreloadStaleTime` to `0`, while an explicit option remains authoritative. A blocking loader calls `ensureRouteData(context, resource, ...args)`, which awaits the store's `ensureData` but resolves to `void`. The component calls `readData` for the same key. Router Core therefore controls when loaders run without retaining a second copy in `loaderData`; the Fig store exclusively owns identity, deduplication, freshness, errors, and the value.

Router `loaderData` remains appropriate for small navigation-scoped orchestration values that do not need independent cache identity, hydration, invalidation, refresh, or streaming. Keyed or shared values use data resources; the adapter does not reproduce a second query/cache vocabulary on top of them.

For non-blocking streaming, a loader calls the explicit `context.data.preloadData` handle and returns. Route error reset invalidates keys attributed to the caught Fig data error before invalidating Router Core, so the same reset affordance retries both layers. Root/global not-found state renders the root route's not-found component through its `Outlet`, preserving the root shell in accordance with Router Core's match contract.

## Link Contract

`Link` always renders a native anchor with an `href`. Fig's `on()` mixin adds client navigation while preserving native behavior for external URLs, reload requests, downloads, non-primary clicks, modifier keys, and non-`_self` targets. Disabled links omit `href` and expose `aria-disabled`. Intent, render, and viewport preloading delegate to `router.preloadRoute`.
