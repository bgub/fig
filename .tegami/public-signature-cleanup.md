---
packages:
  npm:@bgub/fig: minor
  npm:@bgub/fig-dom: minor
---

## Tighten public component, loader, asset, and bind signatures

`@bgub/fig` now names the shared data loader contract as
`DataResourceLoader`, constrains lazy loaders to components, and exposes
`ComponentProps` so lazy wrappers preserve the loaded component's props
without exposing its implementation statics. Client-reference SSR
implementations stay aligned with the reference's props. Stable-event typing
now models the trailing lifecycle signal separately from caller arguments.

`meta()` descriptors now require exactly one valid metadata identity:
`charset`, `name` plus `content`, `property` plus `content`, or `http-equiv`
plus `content`. Raw meta elements that do not satisfy the same shape remain
ordinary host elements instead of entering the asset registry.

`@bgub/fig-dom` payload requests now receive the standard
`DataResourceLoadContext`, portals retain their DOM container type in the
returned `FigPortal`, and bind callbacks must return `undefined`; cleanup is
exclusively driven by their `AbortSignal`.
