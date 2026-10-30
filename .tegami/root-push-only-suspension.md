---
packages:
  "@bgub/fig-reconciler":
    type: patch
---

Preserve pending data reads when suspension reaches the root without a Suspense boundary. Push-only resources can now start their watches and finish initial renders or transitions instead of entering an eviction/retry loop. Use the same lane-scoped handoff as preserved Suspense boundaries and release holds on completion or teardown.
