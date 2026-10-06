---
packages:
  "@bgub/fig-reconciler":
    type: patch
---

Retire stable events, transition starters, and action runners across deleted or hidden subtrees before invoking teardown callbacks. Cleanup from another hook or sibling can no longer start authoritative work in a retiring owner. Preserve kept siblings and restore hidden owners when their Activity reveals.
