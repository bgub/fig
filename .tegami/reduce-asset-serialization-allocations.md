---
packages:
  "@bgub/fig":
    type: patch
  "@bgub/fig-dom":
    type: patch
  "@bgub/fig-server":
    type: patch
---

## Reduce asset serialization allocations

Asset resources now build their canonical host props directly. Server rendering
fills its owned props object in place instead of creating attribute tuples,
filtering them, converting them with `Object.fromEntries`, and cloning again to
append a nonce. Client insertion uses the same canonical props without changing
the generated elements or server HTML.
