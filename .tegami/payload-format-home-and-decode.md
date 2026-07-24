---
packages:
  npm:@bgub/fig:
    replay:
      - exit-prerelease(npm:@bgub/fig)
  npm:@bgub/fig-server:
    replay:
      - exit-prerelease(npm:@bgub/fig-server)
---

## `@bgub/fig/payload`: the browser-safe payload home and `decodePayloadStream`

The payload decoder moved from `@bgub/fig-server/payload` to a new browser-safe
`@bgub/fig/payload` entry. Browser code no longer imports the server package to
decode; fig-server's serializer and the decoder share their private row/value
format through `@bgub/fig/internal`.

New client half: `decodePayloadStream(stream, options)` returns a live
`PayloadDecode` — `value` resolves when the root row decodes while outlined
holes keep streaming in, the never-rejecting `completion` reports
complete/failed/aborted, and `abort()` idempotently rejects unresolved holes
with an internal cancellation reason. Options wire data-row hydration
(`hydrate`), unified client-reference resolution, and asset preparation with
reveal gating (`prepareAssets`).

Internally, `assets` rows now carry an optional `for` — the row id whose
reveal depends on those assets, decided at serialization scope exit so a
suspended subtree's assets gate its outlined row rather than the enclosing
tree.

Dev-time enforcement: serialized components are render-only. During
`renderToPayloadStream`, `useState`, `useActionState`, `useTransition`,
`useStableEvent`, and the effect hooks now throw in development; the read
verbs, `useMemo`, `useId`, and `useSyncExternalStore`'s `getServerSnapshot`
path stay server-safe.
