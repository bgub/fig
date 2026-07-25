---
packages:
  "@bgub/fig-tanstack-router":
    type: patch
  "@bgub/fig-tanstack-start":
    type: patch
---

## Preserve TanStack Start inline CSS during hydration

Adopt the server-rendered contents of TanStack Start's inline CSS placeholder
so full-document hydration no longer replaces the application styles with an
empty style element.
