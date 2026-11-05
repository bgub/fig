---
packages:
  "@bgub/fig-headless":
    replay:
      - exit-prerelease(npm:@bgub/fig-headless)
---

## Add optional popup positioning

Add optional `usePopupPosition` under `@bgub/fig-headless/popup/position` for
viewport-bounded native popups. Support physical and logical sides, alignment,
offsets, configurable viewport padding, flipping, and narrow-screen stacking.
Track layout shifts, clipping, scrolling, resizing, and optional anchor animations.
Preserve authored size constraints and expose placement attributes, anchor
visibility, available dimensions, and transform origins for styling. No positioning
dependency or added code in existing widget entries.
