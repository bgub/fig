---
packages:
  "@bgub/fig-reconciler":
    type: patch
---

## Determine host updates during the begin phase

Determine host and text updates once during the begin phase so child reconciliation only handles identity and placement. Preserve host-requested updates when props are unchanged, parent-before-child updates, and error-boundary recovery for host update predicates.
