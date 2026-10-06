---
packages:
  "@bgub/fig-dom":
    type: patch
---

## Preserve focus during DOM moves

Keep focus when keyed reconciliation moves a focused element or its ancestor. Use native atomic moves where supported to preserve browser interaction and top-layer state; restore focus without scrolling after ordinary moves on older browsers, respecting another target selected by a blur handler.

The fallback also preserves contenteditable selection boundaries and direction when moving a focused subtree.
