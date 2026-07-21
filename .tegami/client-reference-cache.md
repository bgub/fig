---
packages:
  npm:@bgub/fig: minor
  npm:@bgub/fig-dom: minor
---

## Stable client-reference identity across decodes

`@bgub/fig/payload` exposes `createPayloadClientReferenceResolver(resolve)`:
a caller-owned stateful resolver passed as the `resolveClientReference`
decode option. With one, every resolvable client reference decodes to one
resolver-owned wrapper per reference id across all decodes sharing the
resolver — gated, ungated, or asynchronously resolved — so re-decoding a
payload updates islands in place instead of remounting them. Reveal gates
ride the decoded element instances rather than the wrapper: each decode
gates exactly its own content, so a newer decode's pending assets never
re-suspend an island already on screen, while its new island instances
still wait for the stylesheets they declared. The caller owns the
resolver's lifetime; under fast refresh no manual invalidation is needed
(hot edits remap the latched resolution through component families, and
unaccepted updates full-reload), while `delete`/`clear` cover manifest
swaps without a reload. With a plain resolve function, gated and async
references keep their per-decode wrapper identity, now with the same
per-element gating.

`@bgub/fig-dom`'s `payloadDataLoader` accepts the stateful resolver through
its existing `resolveClientReference` option.

Framework adapters can retain one resolver across refreshes and navigations,
preventing asset-gated islands from remounting on every re-decode.
