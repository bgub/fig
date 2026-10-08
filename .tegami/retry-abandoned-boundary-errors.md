---
packages:
  "@bgub/fig-reconciler":
    type: patch
---

## Retry errors from abandoned renders

Discard speculative ErrorBoundary errors and fallbacks when Suspense abandons their render. Retries revisit the failed primary beneath stable wrappers, allowing recovered content to reveal without reporting a stale error. Persistent failures report once after their fallback commits, while already committed error fallbacks remain sticky across suspension. This also prevents missing error callbacks and the development parity failure on Suspense reveal.
