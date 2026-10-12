---
packages:
  "@bgub/fig":
    type: patch
---

Evict unclaimed hydrated values and cached values read by abandoned renders
after the normal inactive retention window. Committed readers still retain
their entries, and eviction retires any background work owned by the value.
