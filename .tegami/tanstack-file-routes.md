---
packages:
  npm:@bgub/fig-tanstack-router:
    replay:
      - exit-prerelease(npm:@bgub/fig-tanstack-router)
  npm:@bgub/fig-tanstack-start:
    replay:
      - exit-prerelease(npm:@bgub/fig-tanstack-start)
---

## Build generated TanStack Start file routes with Fig

`@bgub/fig-tanstack-router` now implements generated file routes, lazy route
records, lazy components, and lazy loader functions. TanStack Start builds and
reloads those routes in development through its existing generator and code
splitter.

`@bgub/fig-tanstack-start` now exposes Start configuration and middleware
factories. Its demo covers request-isolated middleware context, server and
client redirects, generated error and not-found routes, split chunks, SSR,
hydration, and server-function mutations.
