---
packages:
  npm:@bgub/fig-tanstack-router: patch
---

## Make data resources the router's default external cache

Put `root.data` in router context, return `ensureRouteData` from loaders, and
read the same resource with `readData` in components. Data-backed routers now
default `defaultPreloadStaleTime` to `0`, the loader helper resolves to `void`
so the value is not duplicated in `loaderData`, and route reset invalidates
attributed Fig data errors before re-running the router. The adapter also
renders Router Core's global not-found state through the root outlet.
