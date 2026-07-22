---
packages:
  npm:@bgub/fig-dom: minor
  npm:@bgub/fig-reconciler: minor
---

## Restore shadowed document metadata when its winner leaves

Client title and meta entries now keep stable per-fiber ownership claims. The
latest acquired live claim controls the single canonical DOM element; updates
to shadowed claims stay dormant, and removing the winner immediately restores
the latest remaining value.

Hoisted host and declarative asset lifecycle callbacks receive an opaque,
stable `AssetResourceOwner`. Hoisted updates own the complete canonical host
update, including text, so a shadowed fiber cannot overwrite registry state.
