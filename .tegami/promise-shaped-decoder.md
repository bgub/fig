---
packages:
  npm:@bgub/fig: minor
  npm:@bgub/fig-dom: patch
---

## Promise-shaped payload decoder

`decodePayloadStream` now returns `Promise<FigNode>` directly — the root
value promise — instead of a `PayloadDecode` handle. Cancellation is
signal-only (`options.signal`, unchanged); the redundant `abort()` method is
gone. The `completion` promise is replaced by an `onStreamDone(result)`
decode option, called exactly once when ingestion settles as `complete`,
`failed`, or `aborted` — post-root failures that strand no pending hole
remain observable there. The callback is never awaited and its exceptions
and rejections are swallowed, so an observer — sync or async — cannot break
decode teardown or leak an unhandled rejection. The
`PayloadDecode` interface and its non-thenable caveat are deleted;
`PayloadDecodeCompletion` remains as the callback's result type.

`@bgub/fig-dom`'s `payloadDataLoader` migrates internally; its public API is
unchanged.

Also considered and declined: narrowing `ResolveClientReference` to an
opaque id. The reference's `exportName`/`ssr`/`assets` mirror the `client`
row's wire fields and are all load-bearing in framework document pipelines;
the rationale is recorded in `docs/concepts/payload.md`.
