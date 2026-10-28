---
packages:
  "@bgub/fig":
    type: patch
  "@bgub/fig-reconciler":
    type: patch
  "@bgub/fig-dom":
    type: patch
  "@bgub/fig-server":
    type: patch
  "@bgub/fig-tanstack-router":
    type: patch
---

Evict unclaimed hydrated values and cached values read by abandoned renders
after the normal inactive retention window. Committed readers still retain
their entries, and eviction retires any background work owned by the value.

Retain hydrated values while deferred Activity or Suspense hydration, or an active
server render, still needs them. Expire unused hydration batches in default roots
even before the real data store is installed.

Retain keys declared by ensureRouteData for active route matches, independently
of component readers. Transfer those ownership associations during SSR hydration
without rerunning client loaders or copying cached values into loaderData.
