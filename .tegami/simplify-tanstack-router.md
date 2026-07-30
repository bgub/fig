---
packages:
  "@bgub/fig-tanstack-router":
    type: patch
---

## Simplify the TanStack Router adapter

The adapter now centralizes route-head translation, constructs shared link
props once, stabilizes match-value selectors, and isolates client navigation
lifecycle handling behind one internal module. Public routing, SSR, hydration,
asset, and navigation behavior are unchanged.
