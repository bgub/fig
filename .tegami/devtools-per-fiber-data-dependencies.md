---
packages:
  npm:@bgub/fig: minor
  npm:@bgub/fig-reconciler: minor
  npm:@bgub/fig-devtools: minor
---

## DevTools show per-fiber data-resource dependencies

`@bgub/fig` data stores expose `inspectDataDependencyCanonicalKeys(owner)`,
a dev-only inspection read of the canonical keys an owner's committed
`readData` subscriptions point at (returns an empty array in prod builds).

`@bgub/fig-reconciler` devtools snapshots record those keys on every fiber
as `FigDevtoolsFiberSnapshot.dataResourceCanonicalKeys`. The field is
required, so external snapshot producers must supply it (empty array when
unknown).

The `@bgub/fig-devtools` panel filters the Data section by the selected
fiber's dependencies instead of always listing the entire store, and tree
rows show a green badge with the fiber's data-resource read count next to
the blue hook-count badge. Selecting
the root still lists every entry, including those with no committed
subscriber (unclaimed preloads, hydrated-but-unread rows). Refreshing
entries no longer render a redundant `Pending` row.
