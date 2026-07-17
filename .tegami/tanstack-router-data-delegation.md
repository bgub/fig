---
packages:
  npm:@bgub/fig-tanstack-router: patch
---

## Data resources documented as the router's external cache

The README now documents the blessed data story: put `root.data` in router
context, set `defaultPreloadStaleTime: 0`, await `ensureData` in loaders, and
read the same resource with `readData` in components — TanStack's
"pass all loader events to an external cache" pattern with Fig's data store
as the cache. Covered by an adapter test exercising loader/component entry
sharing, store-driven revalidation, and cache hits on re-navigation.
