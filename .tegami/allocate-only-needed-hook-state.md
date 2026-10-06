---
packages:
  "@bgub/fig-reconciler":
    type: patch
---

## Allocate update queues only for queued hooks

Keep update history and rebase state on root, state, transition, and action hooks. Memo, effect, ID, deferred-value, external-store, and stable-event hooks no longer allocate unused queue objects. Hook order, strict rendering, and Suspense retry behavior are unchanged.
