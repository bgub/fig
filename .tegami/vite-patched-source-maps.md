---
packages:
  "@bgub/fig-vite":
    type: patch
---

Copy Babel source-map ignore lists into mutable arrays so the refresh plugin remains compatible with the source-map types used by patched Vite 8.2.4.
