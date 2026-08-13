---
packages:
  "@bgub/fig-tanstack-router":
    type: patch
---

## Fix TanStack Router link lifecycles

Links now preload their current unmasked destination after masked-link updates
and settle per-link transition state when navigation resolves or a blocker
rejects the attempt. Navigation blocker callbacks stay current without
reinstalling a pending resolver. Adapter internals and tests are split along
their lifecycle and subsystem boundaries.
