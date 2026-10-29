---
packages:
  "@bgub/fig-server":
    type: patch
---

## Remove staged content from failed Suspense boundaries

Remove already-streamed staging containers when a boundary fails, including
nested discarded boundaries, before retrying hydration. Preserve fallback
staging and ignore delayed reveals for removed containers.
