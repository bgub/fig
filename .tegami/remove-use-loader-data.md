---
packages:
  npm:@bgub/fig-tanstack-router: minor
---

## Remove `useLoaderData`; enforce void loaders for data-backed routers

The adapter no longer exposes `useLoaderData` (standalone, route-bound, or via
`getRouteApi`): the Fig data store is the single route-data cache, so loader
values are read with `readData` against the same resource the loader ensured.
`useLoaderDeps` remains — deps are loader orchestration, not a cache.

In dev builds, a match that commits with `loaderData` set while
`router.context.data` is configured now throws a diagnostic naming the route.
Derive navigation-scoped values from `useLoaderDeps`, search params, or
`beforeLoad`-returned route context. Routers created without `context.data`
keep Router Core's native loader semantics untouched.
