---
packages:
  "@bgub/fig":
    type: patch
  "@bgub/fig-reconciler":
    type: patch
---

## Keep data reads consistent across yielded renders

Track temporary render-time data snapshots and revalidate them before concurrent commits. Initial reads can no longer remain on an old value when hydration or refresh publishes between render chunks before subscriptions exist.
