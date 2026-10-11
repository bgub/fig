---
packages:
  "@bgub/fig-reconciler":
    type: patch
---

## Retain committed Suspense primary trees without cloning

Reuse the committed primary forest when Suspense shows a fallback. Defer parent-link changes and lane retirement until commit, preserving hidden state, hook lifetimes, and queued updates for reveal while avoiding a recursive clone pass.
