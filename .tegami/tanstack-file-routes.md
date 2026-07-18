---
packages:
  npm:@bgub/fig-tanstack-router: minor
  npm:@bgub/fig-tanstack-start: minor
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
