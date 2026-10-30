---
packages:
  "@bgub/fig":
    type: patch
---

Keep pending loader-backed data entries alive when a replacement Suspense boundary takes over their reads, and release abandoned loads after the handoff opportunity. Handle equality-comparator exceptions as load failures so synchronous and asynchronous refreshes settle with a rejected outcome while preserving the previous value.
