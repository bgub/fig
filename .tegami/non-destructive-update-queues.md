---
packages:
  "@bgub/fig-reconciler":
    type: patch
---

## Read update queues without consuming them during render

Render candidates read a bounded update history; commit acknowledges the observed prefix while retaining late updates and priority-rebase work. Interrupted renders and strict shadow passes no longer clone, consume, or restore shared queues. Suspense commits release only attempted queue prefixes for retry, preserving skipped priorities and updates arriving after a yield.
