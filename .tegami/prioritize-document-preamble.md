---
packages:
  npm:@bgub/fig-server: patch
  npm:@bgub/fig-tanstack-router: patch
---

## Prioritize render-blocking document assets

Full-document rendering now emits parser- and security-sensitive metadata,
connection hints, critical font and image preloads, and stylesheets before
ordinary metadata and lower-priority JavaScript hints. TanStack Router matches
also register authored links and manifest stylesheets before their generated
module preloads, so render-blocking CSS begins loading earlier without changing
stylesheet order.
