---
packages:
  "@bgub/fig-tanstack-start":
    type: major
  "@bgub/fig-tanstack-router":
    type: patch
---

Update the Start and Router adapters to TanStack Start's stable cores. Require
Vite 8, wrap the default server entry with Start's request scope and error
handling, and expose `createServerEntry` and `handleStartError` for custom entries.
Custom entries must wrap `createFigStartHandler` with `createServerEntry` to
convert uncaught errors into responses; the handler itself now rethrows them.
