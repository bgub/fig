---
packages:
  npm:@bgub/fig: minor
  npm:@bgub/fig-dom: minor
  npm:@bgub/fig-start: patch
---

## Stable client-reference identity across decodes

`@bgub/fig/payload` exposes `createPayloadClientReferenceCache()` and a
`clientReferenceCache` decode option. With a cache, every resolvable client
reference decodes to one cache-owned wrapper per reference id across all
decodes sharing the cache — gated, ungated, or asynchronously resolved — so
re-decoding a payload updates islands in place instead of remounting them.
Reveal gates ride the decoded element instances rather than the wrapper:
each decode gates exactly its own content, so a newer decode's pending
assets never re-suspend an island already on screen, while its new island
instances still wait for the stylesheets they declared. The caller owns the
cache's lifetime; under fast refresh no manual invalidation is needed (hot
edits remap the latched resolution through component families, and
unaccepted updates full-reload), while `delete`/`clear` cover manifest swaps
without a reload. Without a cache, gated and async references keep their
per-decode wrapper identity, now with the same per-element gating.

`@bgub/fig-dom`'s `payloadDataLoader` threads a `clientReferenceCache`
option through to the decode.

`@bgub/fig-start` passes a cache from `hydrateStart`, fixing a state-loss
bug: an island whose client row carried assets remounted on every segment
re-decode (refresh, child navigation) because the per-decode gate wrapper
defeated the framework's own reference-id cache, which this replaces.
