---
packages:
  "@bgub/fig-ui":
    type: patch
---

## Preserve rapid radio selections

Uncontrolled radio groups now retain the browser's latest selection when
several native change events arrive before Fig commits a render.
