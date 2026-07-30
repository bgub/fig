---
packages:
  "@bgub/fig":
    type: patch
  "@bgub/fig-server":
    type: patch
---

## Reduce render-path allocations

Child reconciliation now reuses arrays that are already normalized. Server
rendering defers `useId` path formatting on branches that do not request an
ID. This avoids unnecessary allocations in common client-update and sparse-ID
server trees without changing rendered output.
