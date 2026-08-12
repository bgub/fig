---
packages:
  "@bgub/fig":
    type: patch
  "@bgub/fig-dom":
    type: patch
  "@bgub/fig-reconciler":
    type: patch
  "@bgub/fig-refresh":
    type: patch
  "@bgub/fig-server":
    type: patch
---

## Document every JSR entrypoint and exported symbol

All Fig packages now publish module documentation for every JSR entrypoint and
API documentation for their exported symbols. This makes the generated JSR
reference complete and improves package discovery and quality scores.
