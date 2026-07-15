---
packages:
  npm:@bgub/fig: minor
  npm:@bgub/fig-reconciler: patch
  npm:@bgub/fig-server: patch
---

## `isValidElement` has a single home on the main entry

`isValidElement` was the one runtime export with two homes: the app-facing
main entry and `@bgub/fig/internal` (grouped with the other `$$typeof`
brand predicates). It is now exported only from `@bgub/fig`; the renderer
and server packages import it from there. The internal-only predicates
(`isSuspense`, `isPortal`, ...) are unchanged.
