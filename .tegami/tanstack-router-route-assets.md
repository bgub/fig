---
packages:
  npm:@bgub/fig-tanstack-router: patch
  npm:@bgub/fig-tanstack-start: patch
---

## Give each matched route ownership of its Fig assets

Route stylesheets, preload hints, preconnects, font preloads, and async scripts
now enter Fig's shared asset registry at the matched subtree. This gives Start
streaming, client navigation, and Payload assets one deduplicating ownership
model while title, meta, inline styles, JSON-LD, and synchronous scripts retain
their declared document positions.

Manifest `assetCrossOrigin` configuration now belongs to `createRouter`
options, where it is available before the root match renders.
