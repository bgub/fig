---
packages:
  "@bgub/fig-dom": patch
---

Keep every retained binding reachable during updates so error teardown aborts
all live binding signals even when an earlier callback or host binding throws.
