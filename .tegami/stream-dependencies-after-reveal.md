---
packages:
  "@bgub/fig":
    type: patch
  "@bgub/fig-dom":
    type: patch
  "@bgub/fig-reconciler":
    type: patch
  "@bgub/fig-server":
    type: patch
---

## Stream transfer dependencies after the reveal

Streamed Suspense data now sends a read's `transfer` dependencies after the boundary's reveal instead of ahead of it, so their size no longer delays the reveal. A marker for each key goes ahead of the reveal. The browser holds a load of a marked key until the key's form arrives, and the form seeds that load as `transferred`. If the document finishes loading without the form, the load runs without one. A seeded TanStack DB collection therefore still imports its rows and sync metadata before its sync starts. Shell reads, `getData()`, and Payload data rows are unchanged.

A direct reader in another boundary can receive a queued dependency form without waiting for the original boundary to finish. Queued forms also remain available to `takeData()`, and each form is delivered only once.
