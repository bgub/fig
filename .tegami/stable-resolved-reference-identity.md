---
packages:
  npm:@bgub/fig:
    replay:
      - exit-prerelease(npm:@bgub/fig)
---

## Resolved client references keep their identity across decodes

`decodePayloadStream` used to wrap every client reference in a fresh
per-decode component, so re-decoding a surrounding payload (refreshing a
server component that contains islands) remounted every island and dropped
its client state.

References that `resolveClientReference` resolves synchronously and that carry no asset
gate now decode to the resolved component itself. The element type is
identity-stable across decodes, so a refresh of the surrounding payload
updates islands in place and their state survives. Gated or
asynchronously resolved references still decode to per-decode wrappers.
