---
packages:
  "@bgub/fig-dom":
    type: patch
---

## Preserve text selection across DOM commits

Capture input, textarea, and DOM selection once before mutations and restore surviving boundaries and direction before `useBeforePaint`. Child boundaries follow surviving children instead of stale indices, so sibling edits preserve the selected text and caret position. Cover accessible shadow roots, multi-node moves, and focused descendants of editing hosts. Skip removed or reordered boundaries that no longer define a valid range, and clamp shortened text offsets. Component layout policy runs after preservation, replacing per-move callback-intent heuristics with explicit commit ordering.
