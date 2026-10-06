---
packages:
  "@bgub/fig-reconciler":
    type: patch
---

## Unwind render scopes through the fiber return chain

Restore context providers while searching for the boundary that handles a suspended or failed render. This removes separate ancestry scans while preserving nested fallback, hydration recovery, and commit-phase error behavior.
