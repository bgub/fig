---
packages:
  "@bgub/fig-tanstack-router": patch
---

Preserve callbacks, host bindings, and composed binding descriptions supplied
through Link's base, active, and inactive props. Switching active state preserves
unchanged base binding lifetimes and retires the previous state's bindings.
