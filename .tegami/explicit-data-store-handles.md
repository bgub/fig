---
packages:
  "@bgub/fig":
    type: minor
  "@bgub/fig-reconciler":
    type: minor
  "@bgub/fig-server":
    type: minor
---

Remove the ambient `preloadData`, `ensureData`, `refreshData`, `invalidateData`, `invalidateDataKey`, `invalidateDataPrefix`, and `invalidateDataError` exports. Capture `const data = readDataStore()` during render or another synchronous Fig callback, then call the corresponding methods on `data` before or after awaits. Outside Fig, use `root.data`, route `context.data`, or a pre-created store. `readData()` remains the render-only read API.

Remove preloading from the internal render-dispatcher protocol. Store methods preserve existing loading, retention, invalidation, and refresh behavior. After an await, use a transition's `update` callback when transition priority is required.
