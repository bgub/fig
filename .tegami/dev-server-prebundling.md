---
packages:
  npm:@bgub/fig-start: minor
  npm:@bgub/fig-vite: patch
---

## Prebundle Fig packages in the Start dev server

The Start dev server now passes the Fig packages to Vite's dependency
optimizer instead of serving every built dist chunk as its own request,
cutting cold-load request count and letting the browser cache the framework
graph. Because the optimizer caches by lockfile hash, the dev server also
watches workspace-linked package dist directories and forces a re-optimizing
restart when they are rebuilt, so `fig` core edits reach a running dev
session again.

`figRefresh` now imports `@bgub/fig-dom/refresh` through its bare specifier
rather than a resolved `/@fs/` path, so app-level aliases, dedupe, and
prebundling apply and the refresh scheduler cannot be instantiated twice.
