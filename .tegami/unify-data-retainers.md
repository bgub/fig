---
packages:
  "@bgub/fig":
    type: patch
---

Simplify internal data retention bookkeeping by tracking pending callers, dependent generations, and speculative reads in one lazily allocated owner set, preserving existing cancellation and subscription lifetimes.
