---
packages:
  npm:@bgub/fig-dom:
    replay:
      - exit-prerelease(npm:@bgub/fig-dom)
  npm:@bgub/fig-reconciler:
    replay:
      - exit-prerelease(npm:@bgub/fig-reconciler)
---

## Recover full-document Suspense hydration mismatches

Full-document hydration now escalates a mismatch inside the document-level
Suspense boundary to root recovery, preserves the document doctype, and
rebuilds the document without reusing cleared insertion anchors.
