# Payload

Status: stable

Fig's server-component wire layer — `@bgub/fig-server/payload`. The
terminology rule: it is **payload**, never "RSC" or "Flight"; those are React
brands and the format is Fig's own.

## Wire Format

Newline-delimited JSON rows, MIME `text/x-fig-payload`, refresh header
`x-fig-payload-boundary`, `fig-pl-` useId prefixes. Row tags:

- `model` — a serialized tree chunk (id 0 is the root). Trees serialize as
  `$fig`-tagged nodes: elements, fragments, suspense, boundaries, and
  outlined `lazy`/`promise` references that suspend-and-fill by row id.
- `client` — a client reference: `{ id, exportName?, assets?, ssr? }`.
- `data` — settled data-resource hydration entries (see data.md).
- `assets` — stream-safe asset descriptors (see assets.md).
- `error` — `{ digest?, message? }` under the server `onError` contract; the
  decoded chunk rejects with a digest-carrying error.
- `refresh` — a boundary refresh: replaces one `PayloadBoundary`'s content
  by id without replacing the app shell (no React equivalent — React
  refetches whole trees).

Deliberately absent: server actions, temporary references, binary row
encodings — Fig controls both ends, so rows stay plain JSON.

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

Server: `renderToPayloadStream(node, { onError?, refreshBoundary?,
clientReferenceAssets?, dataContext?, dataPartition? })` returns
`{ stream, allReady, contentType }`. `PayloadBoundary` marks refreshable
subtrees (dev throws on duplicate ids).

Client: `createPayloadResponse({ loadClientReference?,
resolveClientReference? })` decodes rows — `processStream(stream)` is the
blessed ingestion seam (`processStringChunk` is the low-level escape hatch),
`rootReady` resolves when the root row decodes (never rejects; race it),
`bindRoot(root)` renders into a Fig root and replays streamed data into
`root.data`, `preloadClientReferences()` awaits in-flight module loads, and
`fetchPayload(response, input, { refreshBoundary? })` fetches and ingests
(namespacing refresh row ids past mounted chunks). Decoded chunks are
memoized so unchanged subtrees bail out of re-renders; refresh rows drop the
decode caches so refreshed boundaries get fresh identities.
