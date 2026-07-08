# Payload

Status: stable API; byte encoding intentionally unstable

Fig's server-component wire layer — `@bgub/fig-server/payload`. The
terminology rule: it is **payload**, never "RSC" or "Flight"; those are React
brands and the format is Fig's own.

## Wire Format

Payload is a semantic row model plus a pluggable byte codec. The row model is
the contract; the exact byte layout is an implementation detail selected by a
`PayloadCodec`.

The built-in development codec is `jsonPayloadCodec`:

- id: `json`
- MIME: `text/x-fig-payload; codec=json; charset=utf-8`
- encoding: newline-delimited JSON rows

Custom codecs expose their own opaque `id`, `contentType`, `encodeRow(row)`,
and `createDecoder(onRow)`. Fig checks the `codec=` content-type parameter at
transport boundaries so a client using one codec does not decode a stream from
another. Codec ids identify implementations, not stable public formats; a
future binary codec can change its internal byte layout while retaining the
same row semantics.

Payload refreshes use the `x-fig-payload-boundary` header. Ids minted by
`useId` during payload render use the `fig-pl-` prefix. Row tags:

- `model` — a serialized tree chunk (id 0 is the root). Trees serialize as
  `$fig`-tagged nodes: elements, fragments, suspense, boundaries, and
  outlined `lazy`/`promise` references that suspend-and-fill by row id.
- `client` — a client reference: `{ id, exportName?, assets?, ssr? }`.
- `data` — settled data-resource hydration entries encoded with the payload
  value codec (see data.md).
- `assets` — stream-safe asset descriptors (see assets.md).
- `error` — `{ digest?, message? }` under the server `onError` contract; the
  decoded chunk rejects with a digest-carrying error.
- `refresh` — a boundary refresh: replaces one `PayloadBoundary`'s content
  by id without replacing the app shell (no React equivalent — React
  refetches whole trees). A targeted refresh wins until a newer parent payload
  model sends that boundary id again; the newer parent-sent initial then
  becomes authoritative.
- `refresh-error` — `{ boundary, value: { digest?, message? } }` for failed
  targeted refresh renders. The client surfaces the decoded server error and
  keeps the previous boundary content.

Deliberately absent from the row model: server actions and temporary
references. Binary byte encodings are allowed as codecs, but no binary codec is
currently the public default.

## Value Serialization

Payload values are not plain `JSON.stringify` payloads. The shared value codec
round-trips:

- JSON scalars and arrays
- plain objects, including objects with a user-authored `$fig` key
- shared references and cyclic graphs across arrays, plain objects, `Map`,
  `Set`, and rendered Fig elements inside one payload request
- `undefined`
- `Date`
- `Map`
- `Set`
- `BigInt`
- `NaN`, `Infinity`, `-Infinity`, and `-0`
- global symbols created with `Symbol.for`

It rejects functions, class instances/non-plain objects, and non-global symbols.
Server component values can additionally contain Fig elements, client
references, and promises; those are serialized by the payload renderer into row
references before the value codec handles ordinary data. Nested containers
recurse through the same serializer rather than becoming opaque values, so any
new container/value type must ship with tests nesting client references,
promises, server elements, shared objects, and cycles inside it.

The model format carries request-wide object ids. The first occurrence of a
supported graph object defines it inline; later occurrences in the same payload
request use a graph reference. Refresh payloads use a fresh id range on the
client so their graph ids cannot collide with earlier payloads decoded by the
same `PayloadResponse`.

The same helpers back payload data rows and Fig Start's remote data transport:
`encodePayloadValue` / `decodePayloadValue` for values and
`encodePayloadDataEntries` / `decodePayloadDataEntries` for hydrated data
entries.

## Client References

`clientReference({ id, load, assets?, ssr? })` marks a component that
serializes as a reference instead of rendering on the server. Ids are opaque
unique keys; Fig's bundler tooling authors them as `"<module>#<export>"`, and
only the server splits that convention — it derives `exportName` once at
serialization, so loaders and the client never string-parse ids. Loading is a
`loadClientReference(metadata)` function (manifest modules map id → import),
`resolveClientReference` short-circuits it, and loads start as reference rows
arrive so module fetches overlap the stream. `ssr`-capable references
server-render through their `ssr` component with modules preloaded.

## API

Server: `renderToPayloadStream(node, { codec?, onError?, refreshBoundary?,
clientReferenceAssets?, dataPartition? })` returns
`{ stream, allReady, contentType }`. `PayloadBoundary` marks refreshable
subtrees (dev throws on duplicate ids).

Client: `createPayloadResponse({ codec?, loadClientReference?,
resolveClientReference? })` decodes rows — `processStream(stream)` is the
blessed ingestion seam (`processBytesChunk` and `processStringChunk` are
low-level escape hatches), `rootReady` resolves when the root row decodes
(never rejects; race it), `bindRoot(root)` renders into a Fig root and replays
streamed data into `root.data`, `preloadClientReferences()` awaits in-flight
module loads, and `fetchPayload(response, input, { refreshBoundary? })`
fetches and ingests (sending the response codec in `Accept`, checking the
response codec id, and namespacing refresh row ids past mounted chunks).
`PAYLOAD_BOUNDARY_HEADER` is the shared header name used for targeted refresh
requests. Non-2xx payload responses reject with `PayloadFetchError`, which
exposes `status` and `response` and cancels the response body before throwing.
Decoded chunks are memoized so unchanged subtrees bail out of re-renders.
Refresh rows clear decoded tree caches so refreshed boundaries get fresh
structure, while retained graph references keep shared decoded values stable.
