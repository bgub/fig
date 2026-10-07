---
packages:
  "@bgub/fig":
    type: patch
  "@bgub/fig-reconciler":
    type: patch
---

## Simplify render and data ownership

Use controller identity to retire superseded actions and transitions, and keep each pending data load with its controller in one record.

Process root and component queues through one operation with explicit fiber ownership.
