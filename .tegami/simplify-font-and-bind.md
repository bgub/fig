---
packages:
  "@bgub/fig":
    type: minor
  "@bgub/fig-dom":
    type: minor
  "@bgub/fig-server":
    type: minor
---

Make `font()` shorthand for a font `PreloadResource`, preserving its anonymous cross-origin default. Remove `FontResource` and the separate `font` descriptor and Payload asset kind; use `preload` with `as: "font"` instead. Update clients and servers together when using Payload.

Remove the redundant `BindCallback` type alias. Use `Bind` for callbacks and `Binding` for the full bind-prop representation.
