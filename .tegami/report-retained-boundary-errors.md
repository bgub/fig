---
packages:
  "@bgub/fig-reconciler":
    type: patch
---

## Report caught errors when retained Suspense content reveals

Restore pending ErrorBoundary reports when Suspense reveals retained content, including boundaries beneath stable wrappers. Report each error once after its fallback commits, and discard reports for removed content. This prevents a development parity error from clearing the root and restores missing production error callbacks.
