---
packages:
  npm:@bgub/fig-tanstack-router: minor
---

## Expand TanStack Router hook and link parity

Router selectors now honor structural sharing, including the router-wide
default, and support selected locations plus loose or optional match reads.
Links gain composable active and inactive props and render-function children
with active and transitioning state. `linkOptions` and `createRouteMask` add
zero-wrapper helpers for reusable, type-checked navigation options. A
published compatibility matrix now distinguishes the guaranteed Start surface
from compatibility, deferred, and deliberately omitted APIs.
