---
packages:
  "@bgub/fig-reconciler":
    type: patch
---

## Unwind render scopes through the fiber return chain

Restore context providers while searching for the boundary that handles a suspended or failed render. This removes separate ancestry scans while preserving nested fallback, hydration recovery, and commit-phase error behavior.

Preserve nested Suspense retries when a fallback also suspends. The surviving outer boundary inherits the discarded inner boundary's pending promises, so primary content can reveal without waiting for its fallback to resolve.
