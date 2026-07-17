---
packages:
  npm:@bgub/fig: minor
  npm:@bgub/fig-reconciler: minor
---

## `ensureData`: the awaitable read for code outside render

`ensureData(resource, ...args)` resolves the value a key would render with:
the cached value when the entry has one (kicking the same background
revalidation a stale `readData` does), or the in-flight load's settlement on
a cache miss. It rejects with the error `readData` would throw, follows
superseding loads and server hydrations to the authoritative value, and never
subscribes — pair it with `readData` in the component, which claims the
settled entry within the preload retention window. An awaiting caller retains
the entry, so the unclaimed-preload eviction cannot abort a load out from
under an ensure.

Available as a free function (ambient store) and on the explicit handle
(`readDataStore()`, `root.data`). This is the delegation verb for external
routers: a route loader awaits `ensureData`, the component reads with
`readData`, and the data store stays the single cache.
