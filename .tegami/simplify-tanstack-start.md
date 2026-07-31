---
packages:
  "@bgub/fig-tanstack-start":
    type: patch
---

## Simplify the TanStack Start adapter

The adapter now uses its renderer directly in the default request path,
centralizes data-store transport validation, simplifies Payload document
injection, and avoids parsing asset-free modules during stylesheet analysis.
Public request, hydration, Payload, and compiler behavior is unchanged.
