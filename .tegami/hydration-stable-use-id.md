---
packages:
  npm:@bgub/fig: patch
  npm:@bgub/fig-dom: patch
  npm:@bgub/fig-reconciler: patch
---

## Keep `useId` stable through selective hydration

`useId` now follows one canonical server/hydration tree path through Suspense
and Activity. Dehydrated boundaries snapshot that path when they claim their
server marker, then restore it when hydration resumes, so client updates that
insert or move surrounding siblings cannot renumber ids already present in the
server HTML. Suspense's private Activity wrapper is transparent to the path.

Components mounted only on the client now receive ids from a separate
`fig-C-*` namespace. Those ids remain stable for the component lifetime and
cannot collide with ids reserved by server-rendered content that has not
hydrated yet.
