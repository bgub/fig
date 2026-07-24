---
packages:
  "@bgub/fig": minor
  "@bgub/fig-server": minor
---

## Preload eligible host images during server rendering

HTML and Payload rendering now derive image preload assets from eager `<img>`
hosts. The hints share Fig's existing asset registry, dedupe against explicit
preloads, preserve responsive `srcset` and `sizes` selection, and arrive before
the content that depends on them.

The first ten distinct images receive early shell delivery without being
forced to high browser priority. Lazy, explicitly low-priority, data-URL,
`<picture>`, and `<noscript>` images remain untouched.
