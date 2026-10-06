---
packages:
  "@bgub/fig":
    type: patch
  "@bgub/fig-reconciler":
    type: patch
  "@bgub/fig-server":
    type: patch
---

## Simplify render and data ownership

Use controller identity to retire superseded actions and transitions, and keep each pending data load with its controller in one record. Consolidate speculative data dependencies into one read map while preserving thrown-read subscriptions and releasing value snapshots at commit. Server reads skip client dependency bookkeeping.

Process root and component queues through one operation with explicit fiber ownership. Invalidate each inconsistent component once when checking data and external-store snapshots.
