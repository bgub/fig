---
packages:
  "@bgub/fig": patch
  "@bgub/fig-server": patch
  "@bgub/fig-tanstack-router": patch
  "@bgub/fig-tanstack-start": patch
---

## Reduce server-render and TanStack Start overhead

Server rendering now avoids redundant child normalization, component-stack,
and asset-classification work. Route assets are normalized lazily, payload
markers are injected without decoding and re-encoding HTML bytes, and
successful stream cancellation propagates directly through the existing Web
stream chain.
