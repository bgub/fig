---
packages:
  "@bgub/fig-reconciler":
    type: patch
---

## Prevent partial Suspense updates

Preserve skipped transition lanes across Suspense retries and urgent reveals so related updates cannot commit partially or become stranded.
