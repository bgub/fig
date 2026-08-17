---
packages:
  "@bgub/fig-dom":
    type: patch
---

## Ignore temporary view transition styles during hydration

Hydration diagnostics no longer report inline view transition declarations
that match a streamed surface's `data-fig-vt-*` annotations, including the
otherwise capture-only `style` attribute. Unrelated authored server styles on
the same element continue to produce the normal diagnostic.
