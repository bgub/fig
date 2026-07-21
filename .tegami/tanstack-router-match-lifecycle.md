---
packages:
  npm:@bgub/fig-tanstack-router: patch
---

## Complete route match rendering semantics

Route matches now honor pending delay and minimum duration, route and default
remount dependencies, explicit Suspense wrapping, client-only and data-only SSR
policies, redirects, and router-level error reporting. Scroll restoration is
installed idempotently and emits its Start SSR bootstrap once.
