---
packages:
  "@bgub/fig-headless": patch
---

Keep keyboard focus separate from submenu activation. Enter hover-opened submenus
on activation, preserve mouse entry, and allow repeated touch, virtual, and
keyboard activation to close a submenu. Restore menu focus when native dismissal
clears it before reconciliation, without stealing caller-directed focus.

Ignore delayed popover toggle confirmations after synchronous beforetoggle
notifications so older native events cannot undo newer open or close requests.

Share cancellable hover intent between tooltips and submenus, preserve diagonal
pointer travel across submenu gaps, and isolate menu initial/return focus policy
in a private helper. Keep travel geometry out of flat-menu and tooltip bundles.
