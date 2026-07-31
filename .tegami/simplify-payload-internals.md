---
packages:
  "@bgub/fig":
    replay:
      - exit-prerelease(npm:@bgub/fig)
  "@bgub/fig-server":
    replay:
      - exit-prerelease(npm:@bgub/fig-server)
---

## Simplify Payload rendering and decoding

Payload now keeps client-reference identity and delivery state together,
encapsulates server asset deduplication and wire lowering, and removes
redundant request, graph, and chunk bookkeeping. The public API, wire values,
streaming, asset gating, cancellation, and error behavior are unchanged.
