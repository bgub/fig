---
packages:
  "@bgub/fig-server":
    replay:
      - exit-prerelease(npm:@bgub/fig-server)
---

## Further simplify HTML server rendering

HTML server rendering now removes unreachable child cases, normalizes host
names once, centralizes request cleanup and document-head asset ordering, and
avoids document-result forwarding closures. Rendered output and streaming,
Suspense, abort, backpressure, asset, and hydration behavior are unchanged.
