---
packages:
  npm:@bgub/fig: minor
  npm:@bgub/fig-server: minor
---

## `@bgub/fig/payload`: the browser-safe payload home and `decodePayloadStream`

The payload wire format — row/model types, `jsonPayloadCodec` and codec
pluggability, the value codec (`encodePayloadValue`/`decodePayloadValue`),
data-entry helpers, codec negotiation, and error-row decoding — moved from
`@bgub/fig-server/payload` to a new browser-safe `@bgub/fig/payload` entry.
Browser code no longer imports the server package to decode; fig-server's
serializer builds against the shared format through `@bgub/fig/internal`.

New client half: `decodePayloadStream(stream, options)` returns a live
`PayloadDecode` — `value` resolves when the root row decodes while outlined
holes keep streaming in, the never-rejecting `completion` reports
complete/failed/aborted, and `abort()` idempotently rejects unresolved holes
with an internal cancellation reason (`isPayloadDecodeAborted`). Options wire
data-row hydration (`hydrate`), client-reference loading, and asset
preparation with reveal gating (`prepareAssets`).

Wire change: `assets` rows now carry an optional `for` — the row id whose
reveal depends on those assets — so the decoder gates exactly the dependent
content. Renames: the codec's row decoder interface is `PayloadRowDecoder`,
and error-row decoding is exported as `errorFromPayloadValue`.

Dev-time enforcement: serialized components are render-only. During
`renderToPayloadStream`, `useState`, `useActionState`, `useTransition`,
`useStableEvent`, and the effect hooks now throw in development; the read
verbs, `useMemo`, `useId`, and `useSyncExternalStore`'s `getServerSnapshot`
path stay server-safe.
