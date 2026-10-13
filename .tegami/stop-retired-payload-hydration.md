---
packages:
  "@bgub/fig":
    type: patch
---

Stop applying a loader's hydration batch if an entry's abort listener retires
the delivering generation. Remaining Payload data entries can no longer
overwrite data published by its successor.
