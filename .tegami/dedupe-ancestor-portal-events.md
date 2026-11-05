---
packages:
  "@bgub/fig-dom":
    type: patch
---

## Avoid duplicate events from ancestor portal targets

DOM events are no longer dispatched twice when a portal target contains its
own Fig root.
