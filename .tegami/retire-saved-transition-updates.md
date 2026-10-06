---
packages:
  "@bgub/fig-reconciler":
    type: patch
---

Disable saved transition update handles as soon as their owner retires, before sibling cleanup can invoke them during Activity hiding, deletion, root unmount, or uncaught-error teardown. Preserve update authority in kept siblings and allow new transitions after reveal.
