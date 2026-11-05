---
packages:
  "@bgub/fig-headless":
    replay:
      - exit-prerelease(npm:@bgub/fig-headless)
---

## Preserve popup scrolling and reveal active options

Reveal Select's active option on opening and keyboard navigation without moving
focus away from the trigger or scrolling pointer highlights. Defer Select and
Combobox scrolling until layout and optional positioning have applied their size
constraints, and cancel stale scroll work. Preserve popup scroll offsets during
positioning measurements so constrained content does not snap back while scrolling.
