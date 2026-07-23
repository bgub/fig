---
packages:
  npm:@bgub/fig-dom: major
  npm:@bgub/fig-tanstack-start: major
---

## Make Payload trees directly renderable

`createPayloadComponent` now creates a props-typed component backed by Fig's
ordinary data store. Complete props form its cache identity by default through
a canonical encoding of Payload-compatible values, and the component works
with route loaders and the existing data-resource freshness APIs and explicit
store handles.

The lower-level `payloadDataLoader` and `PayloadDataLoaderOptions` exports have
been removed. Use `createPayloadComponent`, or `decodePayloadStream` when
managing the transport and data integration directly.

TanStack Start replaces `payloadResource({ key, render })` with
`createPayloadComponent({ key, load: serverPayload(render) })`. Its compiler
can extract a component imported from `.server.tsx`, while initial companion
streams, client references, and compiled asset dependencies keep their existing
transport behavior.

Payload component loaders receive the resolved resource `key` alongside
`signal`, so framework transports can register responses under the exact cache
entry without changing ordinary data loaders.

Default keys are canonical across plain-object property order, and Payload
components use their namespace as their DevTools label. TanStack Start renders
the supplied component inside the Payload renderer so root-level reads and
suspension work, and rejects uncompiled `serverPayload` calls before invoking
application code.

Payload rendering also rejects nesting one Payload component inside another in
development. Payload components are client-visible delivery boundaries;
compose ordinary server components inside them or mount separate Payload
components from the client tree to preserve independent refresh keys.
