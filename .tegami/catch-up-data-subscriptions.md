---
packages:
  "@bgub/fig":
    type: patch
  "@bgub/fig-reconciler":
    type: patch
---

## Catch data changes before subscription commit

Recheck rendered data values after installing subscriptions so updates from deletion cleanup or reentrant subscription callbacks cannot leave a newly mounted reader permanently stale. Schedule missed visible updates synchronously after commit or deferred capture release, while preserving offscreen priority for hidden readers.
