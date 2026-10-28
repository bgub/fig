---
packages:
  "@bgub/fig-tanstack-start":
    type: minor
  "@bgub/fig-tanstack-router":
    type: patch
---

Update the Start and Router adapters to TanStack Start's stable cores. Require
Vite 8, wrap the default server entry and handler factory with Start's request scope and error
handling, and expose `createServerEntry` and `handleStartError` for custom entries.
`createFigStartHandler` continues converting uncaught errors into responses,
so existing custom entries need no additional wrapper.
Preserve registered request-context requirements in published server-entry and
handler-factory types.
