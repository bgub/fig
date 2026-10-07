---
packages:
  "@bgub/fig-reconciler":
    type: major
  "@bgub/fig-dom":
    type: patch
---

## Finish pending captures before synchronous work

Allow synchronous updates and unmount to interrupt pending View Transition captures. Validate pending mutations, restore author styles before urgent work, suppress interrupted transition callbacks, and ignore late browser callbacks.

Custom commit coordinators and View Transition host adapters must return `{ interrupt() }` instead of `"deferred"`. The operation must synchronously finish or reject the pending mutation, restore temporary host state, and release capture. Return `"committed"` only when both mutation and capture restoration have completed.
