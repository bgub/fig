---
packages:
  "@bgub/fig-headless": patch
---

Reveal submenus immediately when their triggers receive focus, without stealing
focus from the parent menu. Close them when focus moves to a sibling, preserve
focus return on dismissal, and enter already open submenus on click.

Ignore delayed popover toggle confirmations after synchronous beforetoggle
notifications so older native events cannot undo newer open or close requests.
