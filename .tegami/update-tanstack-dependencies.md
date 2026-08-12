---
packages:
  "@bgub/fig-reconciler": patch
  "@bgub/fig-tanstack-router": patch
  "@bgub/fig-tanstack-start": patch
---

## Support the latest TanStack Router and Start releases

Update the TanStack adapters to Router Core's current store and render
acknowledgement contracts. Async `act()` now also flushes renderer work that
its callback is waiting for, so navigations can settle inside tests.
