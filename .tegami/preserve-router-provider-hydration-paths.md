---
packages:
  "@bgub/fig-tanstack-router":
    replay:
      - exit-prerelease(npm:@bgub/fig-tanstack-router)
---

## Preserve router provider hydration paths

Server rendering now preserves the provider child slot occupied by the client
transition lifecycle. Route descendants therefore derive the same `useId`
paths on the server and during hydration.
