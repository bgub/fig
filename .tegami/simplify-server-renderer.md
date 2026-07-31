---
packages:
  "@bgub/fig-server":
    replay:
      - exit-prerelease(npm:@bgub/fig-server)
---

## Simplify server rendering state

Server rendering now avoids duplicate completion and task-ownership state,
reuses static callbacks and protocol source, and emits assets without several
temporary arrays and wrapper objects. Rendered HTML, payload rows, streaming,
Suspense, abort, and backpressure behavior are unchanged.
