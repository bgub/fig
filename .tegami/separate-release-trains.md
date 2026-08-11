---
packages:
  "@bgub/fig-refresh": patch
  "@bgub/fig-vite": patch
  "@bgub/fig-tanstack-router": patch
  "@bgub/fig-tanstack-start": patch
---

## Let tooling and adapters follow independent release trains

Fast Refresh and Vite now accept compatible runtime releases instead of
requiring the same exact Fig version. The TanStack Router and Start adapters do
the same while remaining pinned to matching versions within each adapter pair.
