---
packages:
  "@bgub/fig-reconciler":
    type: patch
---

## Summarize context dependencies with a bitmask

Replace descendant context arrays with conservative bitmasks to reduce bookkeeping during rendering. Exact consumer checks and nested-provider scoping remain unchanged, including when more than 32 contexts share a renderer.
