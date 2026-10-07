---
packages:
  "@bgub/fig-dom":
    type: patch
---

## Preserve text selection across DOM commits

Capture input, textarea, and DOM selection once before mutations and restore surviving boundaries and direction before `useBeforePaint`. Cover accessible shadow roots, multi-node moves, and focused descendants of editing hosts. Skip removed endpoints and clamp shortened text offsets. Component layout policy runs after preservation, replacing per-move callback-intent heuristics with explicit commit ordering.
