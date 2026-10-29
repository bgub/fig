---
packages:
  "@bgub/fig-reconciler":
    type: patch
---

Include attempted rebase history when a committed Suspense fallback releases updates for retry. Resolving the promise or urgently revealing the primary now commits the intended state directly, without running effects with stale state first. Preserve skipped priorities and leave abandoned fallback attempts inert.

Initialize retry bookkeeping with each fiber so fresh and reused fibers keep a consistent object layout, avoiding a slowdown in repeated Suspense and error recovery.
