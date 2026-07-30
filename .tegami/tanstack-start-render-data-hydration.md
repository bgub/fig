---
packages:
  "@bgub/fig-tanstack-start": patch
---

## Hydrate render-discovered Fig data

TanStack Start now snapshots Fig data after the document render is ready, so
values first loaded by route components hydrate without duplicate client loads.
