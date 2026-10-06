---
packages:
  "@bgub/fig-reconciler":
    type: patch
---

## Keep deferred commits and subscription cleanup consistent

Revalidate store snapshots immediately before deferred host mutations. Abandon stale transactions without capturing or dispatching view-transition callbacks, then retry after releasing the prepared capture. Publish live hook callbacks and run before-layout effects only when the transaction actually commits.

Retire external-store listeners before calling subscription cleanup so synchronous notifications cannot read an unmounted or replaced store, and throwing cleanup cannot run repeatedly during error recovery.
