---
packages:
  "@bgub/fig-reconciler":
    type: patch
---

## Preserve author styles when a View Transition capture is abandoned

Restore the committed surface's author styles when snapshot validation abandons a deferred capture. Speculative `view-transition-name` and `view-transition-class` props are restored only after successful mutation.
