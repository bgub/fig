## @bgub/fig-headless@0.1.0-alpha.1 (alpha)

### Preserve popup scrolling and reveal active options

Reveal Select's active option on opening and keyboard navigation without moving
focus away from the trigger or scrolling pointer highlights. Defer Select and
Combobox scrolling until layout and optional positioning have applied their size
constraints, and cancel stale scroll work. Preserve popup scroll offsets during
positioning measurements so constrained content does not snap back while scrolling.

### Add optional popup positioning

Add optional `usePopupPosition` under `@bgub/fig-headless/popup/position` for
viewport-bounded native popups. Support physical and logical sides, alignment,
offsets, configurable viewport padding, flipping, and narrow-screen stacking.
Track layout shifts, clipping, scrolling, resizing, and optional anchor animations.
Preserve authored size constraints and expose placement attributes, anchor
visibility, available dimensions, and transform origins for styling. No positioning
dependency or added code in existing widget entries.

### Preserve submenu activation and focus behavior

Keep keyboard focus separate from submenu activation. Enter hover-opened submenus
on activation, preserve mouse entry, and allow repeated touch, virtual, and
keyboard activation to close a submenu. Restore menu focus when native dismissal
clears it before reconciliation, without stealing caller-directed focus.

Ignore delayed popover toggle confirmations after synchronous beforetoggle
notifications so older native events cannot undo newer open or close requests.

Share cancellable hover intent between tooltips and submenus, preserve diagonal
pointer travel across submenu gaps, and isolate menu initial/return focus policy
in a private helper. Keep travel geometry out of flat-menu and tooltip bundles.

## @bgub/fig-headless@0.1.0-alpha.0 (alpha)

### Introduce Fig Headless as an npm alpha

Publish accessible, unstyled widget hooks and render-callback components through
individual package entries, including optional popup positioning and tabs
indicator helpers. Include production builds, development diagnostics, and
TypeScript declarations.

The first public release is `0.1.0-alpha.0` under the `alpha` tag and requires
Fig and Fig DOM 2.x. Alpha releases may change APIs and behavior. Automated
interaction and hydration tests cover the widgets; full cross-browser widget
coverage and manual screen-reader verification remain gates for stable releases.
