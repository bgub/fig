---
packages:
  "@bgub/fig-server":
    replay:
      - exit-prerelease(npm:@bgub/fig-server)
---

## Simplify server rendering internals

Payload rendering now serializes child arrays and asset resources directly
into their destination buffers, while shared server paths avoid transient
metadata, callback, and dispatcher allocations. Public rendering behavior and
wire formats are unchanged.
