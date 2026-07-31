---
packages:
  "@bgub/fig":
    replay:
      - exit-prerelease(npm:@bgub/fig)
  "@bgub/fig-tanstack-router":
    replay:
      - exit-prerelease(npm:@bgub/fig-tanstack-router)
---

## Reduce server link allocations

Server-rendered router links now mark their client navigation behavior directly
instead of resolving a synthetic click mixin. Links without state props, binds,
or mixins also avoid creating empty state objects and composition wrappers.
Payload rendering continues to reject links whose client navigation behavior
would otherwise be lost.
