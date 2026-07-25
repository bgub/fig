---
packages:
  "@bgub/fig-tanstack-router":
    replay:
      - exit-prerelease(npm:@bgub/fig-tanstack-router)
  "@bgub/fig-tanstack-start":
    replay:
      - exit-prerelease(npm:@bgub/fig-tanstack-start)
---

## Preserve TanStack Start inline CSS during hydration

Adopt the server-rendered contents of TanStack Start's inline CSS placeholder
so full-document hydration no longer replaces the application styles with an
empty style element.
