---
packages:
  "@bgub/fig-tanstack-router":
    replay:
      - exit-prerelease(npm:@bgub/fig-tanstack-router)
---

## Reuse server route asset plans

Server rendering now builds each route match's asset plan once and reuses it
for match content, head tags, and body scripts. TanStack's inline-CSS manifest
is snapshotted once per render so its generated wrappers do not defeat the
cache.
