---
packages:
  npm:@bgub/fig-vite: patch
  npm:@bgub/fig-tanstack-start: patch
---

## Refresh resolves the app's renderer runtime

`figRefresh` now imports `@bgub/fig-dom/refresh` through its bare specifier
rather than a resolved `/@fs/` path, so app-level aliases, dedupe, and
prebundling apply and the refresh scheduler cannot be instantiated twice.

## TanStack Start's client graph is prebundled

The TanStack Start adapter now prebundles `@tanstack/start-client-core` in
development while leaving its application-bound router and Start imports as
external Vite modules. This reduces the module-request waterfall without
freezing generated app entries or the linked Fig adapter packages. Production
continues to use Vite's normal application bundling.

## Data transforms use Vite's environment

`figData()` now uses Vite's transform environment directly instead of exposing
a manual `target` override. The unused server-resource discovery IDs and root
path bookkeeping have also been removed.
