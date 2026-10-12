---
packages:
  "@bgub/fig-reconciler":
    type: patch
---

## Determine host updates during completion

Determine host and text updates during fiber completion so child reconciliation only handles identity and placement. Preserve host-requested updates when props are unchanged.
