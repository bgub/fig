---
packages:
  "@bgub/fig-tanstack-router": patch
---

## Reduce server link rendering overhead

Links rendered on the server now skip browser-only lifecycle, subscription,
preload, and event setup. Server and client links retain matching component
trees for stable hydration, while Payload rendering continues to reject links
whose navigation behavior cannot be serialized.
