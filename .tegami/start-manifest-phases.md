---
packages:
  "@bgub/fig-tanstack-start":
    type: patch
---

Separate Isomorphic reference resolution from manifest stylesheet enrichment.
Payload transforms resolve component identities without constructing development
stylesheet metadata; manifest loading retains stylesheet URLs and HMR fingerprints.
