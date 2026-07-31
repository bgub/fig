---
packages:
  "@bgub/fig":
    replay:
      - exit-prerelease(npm:@bgub/fig)
  "@bgub/fig-dom":
    replay:
      - exit-prerelease(npm:@bgub/fig-dom)
  "@bgub/fig-server":
    replay:
      - exit-prerelease(npm:@bgub/fig-server)
---

## Reduce asset serialization allocations

Asset resources now build their canonical host props directly. Server rendering
fills its owned props object in place instead of creating attribute tuples,
filtering them, converting them with `Object.fromEntries`, and cloning again to
append a nonce. Client insertion uses the same canonical props without changing
the generated elements or server HTML.
