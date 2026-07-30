---
packages:
  "@bgub/fig-tanstack-router": patch
---

## Reuse server route asset plans

Server rendering now builds each route match's asset plan once and reuses it
for match content, head tags, and body scripts. TanStack's inline-CSS manifest
is snapshotted once per render so its generated wrappers do not defeat the
cache.
