---
packages:
  "@bgub/fig-server":
    replay:
      - exit-prerelease(npm:@bgub/fig-server)
---

## Reduce server flush garbage collection

Server streaming now accumulates each flush pass in one string instead of an
array that must be flattened before encoding. This shortens the lifetime of
serialized response data and substantially reduces garbage-collection pauses
without changing stream chunk boundaries or rendered HTML.
