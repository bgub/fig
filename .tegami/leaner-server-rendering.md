---
packages:
  npm:@bgub/fig:
    replay:
      - exit-prerelease(npm:@bgub/fig)
  npm:@bgub/fig-server:
    replay:
      - exit-prerelease(npm:@bgub/fig-server)
  npm:@bgub/fig-tanstack-router:
    replay:
      - exit-prerelease(npm:@bgub/fig-tanstack-router)
  npm:@bgub/fig-tanstack-start:
    replay:
      - exit-prerelease(npm:@bgub/fig-tanstack-start)
---

## Reduce server-render and TanStack Start overhead

Server rendering now avoids redundant child normalization, component-stack,
and asset-classification work. Route assets are normalized lazily, payload
markers are injected without decoding and re-encoding HTML bytes, and
successful stream cancellation propagates directly through the existing Web
stream chain.
