---
packages:
  "@bgub/fig-dom":
    type: patch
---

## Preserve text selection during atomic DOM moves

Restore contenteditable selection boundaries and direction after native `moveBefore()` reorders a focused element or its ancestor, while respecting selection changes made by custom-element move callbacks. Real-browser regression coverage exercises native and fallback moves, input and textarea selection, focus chosen by blur handlers, scrolling, and native dialog/popover state in development and production builds.
