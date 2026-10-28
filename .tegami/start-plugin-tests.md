---
packages:
  "@bgub/fig-tanstack-start":
    type: patch
---

Preserve concrete internal Vite plugin types and test each plugin factory directly.
Remove duplicated hook interfaces and positional plugin casts while retaining
separate plugin-composition and ordering checks.
