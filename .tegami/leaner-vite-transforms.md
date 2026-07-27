---
packages:
  npm:@bgub/fig-vite:
    replay:
      - exit-prerelease(npm:@bgub/fig-vite)
---

## Avoid redundant Vite transforms

Production builds now rely on Vite's scope-aware `__FIG_DEV__` replacement
instead of running an additional Babel pass. Development loads the refresh
transformer only when a matching application module needs it.
