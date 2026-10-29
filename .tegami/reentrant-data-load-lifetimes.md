---
packages:
  "@bgub/fig":
    type: patch
---

Make data load replacement and retirement safe when abort listeners synchronously start new work. Refresh, rejection, hydration, eviction, and attributed-error invalidation preserve successor values, signals, and pending results. Skip loaders superseded before invocation and stop hydration batches after store disposal. Treat throwing thenable accessors as normal loader failures.
