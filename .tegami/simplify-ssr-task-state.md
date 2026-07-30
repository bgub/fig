---
packages:
  "@bgub/fig-server":
    type: patch
---

## Simplify HTML server-rendering state

HTML server rendering now resumes suspended tasks from their existing render
frames and derives pending work and scheduling from its task collections. This
removes duplicated state and allocation while preserving streamed HTML,
Suspense, abort, backpressure, asset, and hydration behavior.
