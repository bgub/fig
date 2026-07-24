---
packages:
  npm:@bgub/fig-server: minor
  npm:@bgub/fig-tanstack-start: minor
---

## Expose render-discovered assets as response preload headers

Server stream results now provide a bounded, deduplicated HTTP `Link` value for
preconnects, fonts, stylesheets, explicit preloads, and module preloads
discovered before the shell becomes ready. Filters let adapters exclude asset
URLs that are unsafe for a shared cache.

The TanStack Start renderer can opt into merging that shell snapshot with the
response's existing `Link` header before constructing the streamed response.
Assets discovered after the shell continue to arrive through HTML streaming.
