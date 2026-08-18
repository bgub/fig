---
packages:
  "@bgub/fig-tanstack-router":
    type: patch
---

## Fix consecutive TanStack Router view transitions

TanStack Router history loads now retain their promises inside Fig's transition
scope, so preloaded, cached, back, and forward routes continue to animate shared
elements across consecutive client-side navigations.
