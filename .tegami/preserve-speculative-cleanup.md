---
packages:
  "@bgub/fig":
    type: patch
---

Preserve existing inactive-data eviction timers across speculative cached reads
through loader-backed resources. Committed readers still cancel eviction, while
abandoned reloadable reads no longer leave previously expiring entries cached
indefinitely. Hydrate-only reads preserve their existing retention behavior.
