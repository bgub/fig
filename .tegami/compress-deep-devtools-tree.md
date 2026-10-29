---
packages:
  "@bgub/fig-devtools":
    type: patch
---

## Make deeply nested DevTools trees collapsible

The component tree now starts fully expanded, adds disclosure controls to every
parent, and opens manually collapsed ancestor paths when inspecting page
elements. Horizontal positioning follows vertical scrolling and selection
instead of exposing a manual horizontal scrollbar. Inspecting components that
read multiple anonymous contexts no longer triggers duplicate-key errors.
