---
packages:
  "@bgub/fig-dom":
    replay:
      - exit-prerelease(npm:@bgub/fig-dom)
---

## Avoid false selected-option hydration warnings

Hydrating a select now recognizes the `selected` attributes synthesized by
server rendering from the select's value. Genuine mismatched selected options
still produce a development warning, and uncontrolled selects continue to
preserve user changes made before hydration.
