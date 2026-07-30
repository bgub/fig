---
packages:
  "@bgub/fig":
    type: patch
  "@bgub/fig-tanstack-router":
    type: patch
---

## Reduce server link allocations

Server-rendered router links now mark their client navigation behavior directly
instead of resolving a synthetic click mixin. Links without state props, binds,
or mixins also avoid creating empty state objects and composition wrappers.
Payload rendering continues to reject links whose client navigation behavior
would otherwise be lost.
