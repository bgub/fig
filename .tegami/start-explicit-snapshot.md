---
packages:
  "@bgub/fig-tanstack-start":
    type: patch
---

Filter Payload-backed entries at the document snapshot serialization boundary
using its explicit key lookup. Remove the ambient filtering fallback and the
unused read-only request-registry mode while preserving late Payload registration.
