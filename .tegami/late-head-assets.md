---
packages:
  npm:@bgub/fig: patch
  npm:@bgub/fig-dom: minor
  npm:@bgub/fig-server: major
---

## Deliver late title and meta assets

Late streamed title and meta resources now update `document.head` through the
inline runtime and also travel over payload asset rows. The obsolete
`onAssetError`, `ServerAssetErrorInfo`, and `ServerAssetDestination`
server-render APIs are removed because late head assets are delivered rather
than diagnosed and dropped.
