---
packages:
  "@bgub/fig-reconciler":
    type: patch
---

## Preserve root renders across initial scheduler yields

Process the root update queue inside its fiber work unit so same-priority root renders arriving during the initial scheduler yield are included. The latest render now commits without needing another update to wake the root.
