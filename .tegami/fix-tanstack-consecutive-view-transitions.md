---
packages:
  "@bgub/fig-tanstack-router":
    type: patch
---

## Fix consecutive TanStack Router view transitions

Link and browser-history navigations now retain the promises returned by
TanStack Router inside Fig's transition scope, so preloaded, cached, back, and
forward routes continue to animate shared elements across consecutive
client-side navigations. Canceled link navigations also settle their transition
scope immediately instead of retaining transition priority until a later
navigation.
