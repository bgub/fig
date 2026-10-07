---
packages:
  "@bgub/fig-reconciler":
    type: patch
---

## Preserve hydration snapshots and release discarded data reads

Keep intentional server snapshots valid through deferred selective hydration while continuing to validate client snapshot reads in the same commit. Activity reveals no longer repeatedly abandon View Transition captures when server and client snapshots differ.

Release speculative data snapshots before Suspense or error-boundary rollback removes their owners from the commit index, including suspended attempts retained by committed fiber alternates.
