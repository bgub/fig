---
packages:
  "@bgub/fig": patch
  "@bgub/fig-dom": patch
  "@bgub/fig-reconciler": patch
  "@bgub/fig-refresh": patch
  "@bgub/fig-server": patch
  "@bgub/fig-vite": patch
  "@bgub/fig-tanstack-router": patch
  "@bgub/fig-tanstack-start": patch
---

## Publish stable pre-1.0 releases

Fig's runtime, tooling, and TanStack adapter packages now publish without an
`alpha` prerelease suffix. Patch releases preserve compatibility within their
current `0.x` minor line; minor releases may make breaking changes before 1.0.
