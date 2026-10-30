---
packages:
  "@bgub/fig":
    type: patch
---

Keep pending loader-backed data entries alive when a replacement Suspense boundary takes over their reads, without cancelling loads needed by suspended transitions. Handle equality-comparator exceptions as load failures so synchronous and asynchronous refreshes settle with a rejected outcome while preserving the previous value.
