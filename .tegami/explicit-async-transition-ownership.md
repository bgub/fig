---
packages:
  "@bgub/fig": major
  "@bgub/fig-reconciler": major
  "@bgub/fig-server": major
  "@bgub/fig-tanstack-router": patch
---

## Explicit async transition ownership

Transition callbacks now receive `(signal, update)`. Wrap post-await updates in `update(() => ...)` to schedule them in the original transition and restore its data store. Pending async callbacks no longer capture unrelated updates. Update handles become inert on callback settlement or cancellation. Action result scheduling remains automatic; arbitrary post-await setters have ordinary priority. Router history loading no longer opens a long-lived transition scope.
