---
packages:
  "@bgub/fig-dom":
    type: patch
---

## Preserve stopped propagation on read-only DOM events

Logical propagation stops now call the restored native `stopPropagation()`
method instead of assigning `cancelBubble`, which can be read-only in DOM
implementations.
