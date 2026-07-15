---
packages:
  npm:@bgub/fig: minor
  npm:@bgub/fig-dom: patch
---

## Move `createPortalNode` to `@bgub/fig/internal`

`createPortalNode` is the cross-package seam renderers wrap in their
container-typed `createPortal`; apps never call it directly. It now lives
on the internal entry with the other renderer protocol exports instead of
the app-facing main entry. Portal-creating apps keep using
`createPortal(children, container, key?)` from `@bgub/fig-dom`; the
`FigPortal` type stays on the main entry because it appears in public
signatures.
