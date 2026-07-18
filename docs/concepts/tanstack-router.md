# TanStack Router Adapter

Status: implemented adapter surface; broader Router feature parity remains incremental

`@bgub/fig-tanstack-router` adapts `@tanstack/router-core` to Fig without forking TanStack's route matching, loading, history, or navigation contracts. The package owns only the framework seam: Fig components and hooks, native DOM link behavior, and the reactive store factory supplied to `RouterCore`.

## Initial Surface

The adapter surface consists of `createRootRoute`, `createRootRouteWithContext`, `createRoute`, `createFileRoute`, `createLazyFileRoute`, `lazyRouteComponent`, `lazyFn`, `createRouter`, `getRouteApi`, `RouterProvider`, `Matches`, `MatchRoute`, `Navigate`, `Outlet`, `HeadContent`, `Scripts`, `Link`, `ensureRouteData`, and the router, location, match-list, match-route, match, params, search, loader-deps, loader-data, route-context, and navigation hooks. Targeted hooks accept `{ from: routeId }` and an optional selector to subscribe directly to a specific active match and infer its value from the registered tree.

Route objects, root-route objects, and `RouteApi` expose the canonical bound interface: `useMatch`, `useParams`, `useSearch`, `useLoaderDeps`, `useLoaderData`, `useRouteContext`, `useNavigate`, `Link`, and `notFound`. Bound hooks close over the route id; navigation and links close over its full path. `getRouteApi(id)` resolves the full path from the registered router at render time, so code outside a route module gets the same interface without retaining a route instance. Generated-tree transforms preserve the interface through Router Core's `RouteExtensions` seam.

`createFileRoute` creates an uninitialized non-root `BaseRoute`; TanStack's generated tree supplies its parent, id, and path with `update`, then attaches generated children and file types. `createLazyFileRoute` returns the lazy option record Router Core merges into that route. `lazyRouteComponent` caches one dynamic import, exposes its preload function, and suspends through Fig's `readPromise` until the selected component export resolves. `lazyFn` is Router Core's typed lazy function loader.

The current generator accepts only React, Solid, and Vue targets and hard-codes the corresponding constructor import during route-file normalization. The Start plugin therefore uses the Solid package ID as a build-time alias to Fig; no Solid runtime participates. A native framework target removes that source-level compatibility ID but does not change the route object or rendering contracts.

The adapter pins the Router core version it is built and tested against. TanStack's store is an implementation detail: it supplies the dependency graph for Router's atoms and derived stores but is not re-exported as a Fig Store API. The package publishes on npm rather than JSR because TanStack framework adapters require ambient augmentation of `@tanstack/router-core`, which JSR does not accept in source-native packages.

## Signal Graph

The adapter follows Router Core's [signal-graph architecture](https://tanstack.com/blog/tanstack-router-signal-graph): top-level atoms and per-match stores are the sources of truth, while `router.state` is the compatibility snapshot derived from them. Browser routers supply TanStack Store atoms for mutable and derived stores; server routers use Core's non-reactive stores because a server render reads each value once.

Framework internals subscribe to the narrowest available store. `useLocation` and `Link` read the location atom, `Matches` reads the derived first-match ID, `useMatches` reads the match-list store, `useMatchRoute` reads the match-route dependency store, each rendered match reads its own match store, and targeted or route-bound hooks use Core's LRU-cached per-route store. Only the public `useRouterState` compatibility hook subscribes to the aggregate `router.state` store. This topology is an implementation contract rather than an additional application-facing API.

`Navigate` runs after commit through Fig's before-paint lifecycle. It compares navigation option values rather than props-object identity, preventing a still-active redirect route from restarting the same navigation when Router state changes during loading.

## Route Data Contract

Fig data resources are the default external cache for route data. Applications place the root's `FigDataStoreHandle` at `router.context.data`; its presence makes `createRouter` default `defaultPreloadStaleTime` to `0`, while an explicit option remains authoritative. A blocking loader calls `ensureRouteData(context, resource, ...args)`, which awaits the store's `ensureData` but resolves to `void`. The component calls `readData` for the same key. Router Core therefore controls when loaders run without retaining a second copy in `loaderData`; the Fig store exclusively owns identity, deduplication, freshness, errors, and the value.

For non-blocking streaming, a loader calls the explicit `context.data.preloadData` handle and returns. Route error reset invalidates keys attributed to the caught Fig data error before invalidating Router Core, so the same reset affordance retries both layers. Root/global not-found state renders the root route's not-found component through its `Outlet`, preserving the root shell in accordance with Router Core's match contract.

## Link Contract

`Link` always renders a native anchor with an `href`. Fig's `on()` mixin adds client navigation while preserving native behavior for external URLs, reload requests, downloads, non-primary clicks, modifier keys, and non-`_self` targets. Disabled links omit `href` and expose `aria-disabled`. Intent, render, and viewport preloading delegate to `router.preloadRoute`.
