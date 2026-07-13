# Payload

Status: stable API; byte encoding intentionally unstable

Fig's server-component wire layer. The terminology rule: it is **payload**, never "RSC" or "Flight"; those are React brands and the format is Fig's own.

Payload is a **data format, not an architecture**. A server serializes a rendered component tree into a stream of rows; a client decodes that stream back into renderable elements. Everything above the format — endpoints, refresh policy, caching, hydration timing — belongs to the data layer and frameworks (see data.md and `docs/plans/serialized-components.md`). Core keeps the format; frameworks own the wire.

## Homes

- `@bgub/fig/payload` — the browser-safe home: the row and model types, `jsonPayloadCodec` and codec pluggability (`PayloadCodec`), the value codec (`encodePayloadValue` / `decodePayloadValue`), data-entry helpers (`encodePayloadDataEntries` / `decodePayloadDataEntries`), codec negotiation (`payloadCodecIdFromContentType`, `assertPayloadCodecMatches`), error-row decoding (`errorFromPayloadValue`), and the client half: `decodePayloadStream`. Browser code never imports `@bgub/fig-server` to decode.
- `@bgub/fig-server/payload` — the server half: `renderToPayloadStream` and the inline frame transport.
- `@bgub/fig` — `clientReference`, the one escape hatch for interactivity inside a serialized tree.
- `@bgub/fig-dom` — `payloadDataLoader`, the web adapter that turns a payload endpoint into an ordinary data-resource loader: HTTP/codec validation, `insertAssetResources` as `prepareAssets`, the store's generation-guarded hydration capability, and the generation-lifetime signal wired into `decodePayloadStream` (data.md).

## Wire Format

Payload is a semantic row model plus a pluggable byte codec. The row model is the contract; the exact byte layout is an implementation detail selected by a `PayloadCodec`.

The built-in development codec is `jsonPayloadCodec`:

- id: `json`
- MIME: `text/x-fig-payload; codec=json; charset=utf-8`
- encoding: newline-delimited JSON rows

Custom codecs expose their own opaque `id`, `contentType`, `encodeRow(row)`, and `createDecoder(onRow)` (a `PayloadRowDecoder`). Fig checks the `codec=` content-type parameter at transport boundaries so a client using one codec does not decode a stream from another. Codec ids identify implementations, not stable public formats; a future binary codec can change its internal byte layout while retaining the same row semantics. Decoders call `onRow` for each complete semantic row; `onRow` may throw, and decoders must propagate that error. If a decoder has already buffered more complete sibling rows in the same input chunk, it should deliver those rows before rethrowing so row notifications already implied by the chunk are not lost.

Ids minted by `useId` during payload render use the `fig-pl-` prefix. Row tags:

- `model` — a serialized tree chunk (id 0 is the root). Trees serialize as `$fig`-tagged nodes: elements, fragments, suspense, and outlined `lazy`/`promise` references that suspend-and-fill by row id.
- `client` — a client reference: `{ id, exportName?, assets?, ssr? }`.
- `data` — settled data-resource hydration entries encoded with the payload value codec (see data.md).
- `assets` — stream-safe asset descriptors (see assets.md), plus an optional `for`: the row id whose reveal depends on these assets. The owning row is decided at serialization scope exit: a subtree that completes keeps its assets with the row it inlines into, while one that suspends or fails takes the assets discovered inside it to its outlined row — so a stylesheet belonging to a streamed hole never gates the enclosing tree's reveal. Scope exits happen within the same synchronous serialization attempt, so association costs no preload latency.
- `error` — `{ digest?, message? }` under the server `onError` contract; the referenced chunk rejects with a digest-carrying error (`errorFromPayloadValue`).

There is deliberately no refresh row: the refresh unit is the data-resource key that delivers the payload (data.md), so a refresh is simply a new request for the same stream.

Deliberately absent from the row model: server actions and temporary references. Binary byte encodings are allowed as codecs, but no binary codec is currently the public default.

## Value Serialization

Payload values are not plain `JSON.stringify` payloads. The shared value codec round-trips:

- JSON scalars and arrays
- plain objects, including objects with a user-authored `$fig` key
- shared references and cyclic graphs across arrays, plain objects, `Map`, `Set`, and rendered Fig elements inside one payload request
- `undefined`
- `Date`
- `Map`
- `Set`
- `BigInt`
- `NaN`, `Infinity`, `-Infinity`, and `-0`
- global symbols created with `Symbol.for`

It rejects functions, class instances/non-plain objects, and non-global symbols. Server component values can additionally contain Fig elements, client references, and promises; those are serialized by the payload renderer into row references before the value codec handles ordinary data. Nested containers recurse through the same serializer rather than becoming opaque values, so any new container/value type must ship with tests nesting client references, promises, server elements, shared objects, and cycles inside it.

The model format carries request-wide object ids. The first occurrence of a supported graph object defines it inline; later occurrences in the same payload request use a graph reference. Definitions always precede references in the row stream, so a streaming decoder never sees a dangling reference in a well-formed stream.

The same helpers back payload data rows and Fig Start's remote data transport: `encodePayloadValue` / `decodePayloadValue` for values and `encodePayloadDataEntries` / `decodePayloadDataEntries` for hydrated data entries.

## Server Components Are Render-Only

The server/client line is statefulness, not reads. During `renderToPayloadStream`, the read verbs are server-safe — `readContext`, `readPromise`, `readData` (the render has a per-request store; a pending read suspends that subtree into an outlined streaming hole) — along with `useMemo` and `useId`, and `useSyncExternalStore`'s `getServerSnapshot` path (a read, not a subscription). State, effects, and interactivity **throw at dev time**: `useState`, `useActionState`, `useTransition`, `useStableEvent`, `useReactive`, `useBeforePaint`, `useBeforeLayout`. A serialized component never re-runs on the client, so those APIs would silently freeze initial state into the wire. Event and bind props are functions and already fail serialization. Interactivity belongs to client references.

Context is render-scoped and erased by serialization: `renderToPayloadStream(<SessionContext value={session}><Post /></SessionContext>)` is the idiomatic request-state injection, `readContext` resolves at render time, and nothing context-shaped crosses the wire — every function component has already run. Client context reaches client-reference islands, not the serialized tree itself: islands are real client components and read context from wherever the decoded tree sits, so `{post}` rendered under a client `ThemeProvider` themes every island inside the post. Server-tree-provides-context-to-islands is deliberately unsupported: pass props to the reference, or wrap the island in a client provider component.

## Client References

`clientReference({ id, load, assets?, ssr? })` marks a component that serializes as a reference instead of rendering on the server. Ids are opaque unique keys; Fig's bundler tooling authors them as `"<module>#<export>"`, and only the server splits that convention — it derives `exportName` once at serialization, so loaders and the client never string-parse ids. Loading is a `loadClientReference(metadata)` function (manifest modules map id → import), `resolveClientReference` short-circuits it, and loads start as reference rows arrive so module fetches overlap the stream. `ssr`-capable references server-render through their `ssr` component when a server-side decode resolves them (fig-start's document path).

## Server API

`renderToPayloadStream(node, { codec?, onError?, clientReferenceAssets?, dataPartition?, highWaterMark?, signal? })` returns `{ stream, allReady, contentType, abort(reason?) }`. `signal` and `abort()` cancel hung payload renders and reject `allReady`. Error rows follow the `onError → { digest?, message? }` contract (errors.md). Streams respect consumer backpressure with the same contract as the HTML renderer (server-rendering.md Flow Control): rendering and `allReady` are task-driven, row flushing pauses at the byte high-water mark (default 65536) and resumes on pulls, gated between rows so every chunk stays one-or-more complete wire rows.

Inline frame transport: how a document render carries payload rows to the client as inline scripts interleaved between HTML chunks (parse-safe per the complete-markup chunk contract, server-rendering.md). `payloadFrameBootstrapScript(options?)` installs the `{ q, p, s }` frame-queue global (must run before any frame; `payloadFrameBootstrapCode` is the raw JS for JSX-authored heads), `payloadFrameScript(frame, options?)` emits one frame as a JSON carrier script plus a push script, and the client's `getPayloadFrameStream(options?)` returns the queue — creating it and replaying document frames it missed when the bundle ran mid-stream or without the bootstrap. Frames are caller-defined JSON values (a raw row-chunk string, or an envelope like Fig Start's `{ chunk, id }`); options scope the queue global name and carrier attribute, and `nonce` flows to every emitted script.

## Client API: `decodePayloadStream`

`decodePayloadStream(stream, { codec?, signal?, hydrate?, loadClientReference?, resolveClientReference?, prepareAssets? })` is the renderer-neutral client half. It returns a live `PayloadDecode`, ingests rows in the background, and aborts on the generation-lifetime signal:

```ts
interface PayloadDecode {
  value: Promise<FigNode>;
  completion: Promise<
    | { status: "complete" }
    | { status: "failed"; error: unknown }
    | { status: "aborted" }
  >;
  abort(reason?: unknown): void;
}
```

- `value` resolves when the root row (id 0) decodes, while decoding continues in the background; unfinished subtrees inside it are outlined holes that suspend and fill (or reject) as their rows arrive. `value` rejects only when the stream fails before producing a root value, or with the root row's own `error` row.
- `completion` **never rejects**, so callers observe post-root transport/protocol failure without creating an unhandled rejection. Post-root failures propagate to UI by rejecting unresolved decoded holes; a failure cannot retroactively throw through already fully decoded content that no longer has a pending slot.
- `abort(reason?)` is idempotent: remaining rows are ignored, unresolved holes reject with an internal abort reason that does not become a user error (`isPayloadDecodeAborted`), and completion reports `aborted`. Content whose row already arrived but is waiting on an asset gate reveals instead of rejecting.
- `PayloadDecode` deliberately does not implement `PromiseLike`: thenable assimilation would discard `completion` and `abort` when returned through an `async` loader.
- `hydrate(entries)` receives decoded `data` rows. The capability is expected to be generation-guarded by its supplier: it hydrates through the calling store only while that load generation is authoritative and returns `false` after supersession (data.md).
- `prepareAssets(assets)` is called with stream-safe asset resources as soon as their rows arrive (fig-dom's `insertAssetResources` is the intended web implementation). A returned promise gates the reveal of only the content that declared a dependency — the row named by an assets row's `for`, or the island referencing a `client` row's own assets. Gate settlement (fulfilled _or_ rejected) releases the reveal; a failed asset never blocks content.
- Client-reference module loads start at row arrival and overlap the stream. A load or resolution failure rejects the referencing decoded component when it renders — through whatever `ErrorBoundary` covers it — and fails completion only when it prevents protocol ingestion from continuing.

### Failure Semantics

| Failure | Observable result |
| --- | --- |
| Transport, codec, or protocol failure before the root row | `decode.value` rejects; `completion` resolves `{ status: "failed", error }`. |
| `error` row for the root | `decode.value` rejects with the digest-carrying error; ingestion itself completes. |
| `error` row belonging to an outlined hole | That hole rejects; the nearest `ErrorBoundary` covering that decoded slot handles it (digest contract intact). The fulfilled root value remains published. |
| Truncated or malformed stream after the root row | Every unresolved hole rejects with the transport/protocol error and propagates through its nearest `ErrorBoundary`; `completion` resolves `{ status: "failed", error }`; the fulfilled value stays published. |
| Client-reference load or resolution failure | The referencing decoded component rejects through its nearest `ErrorBoundary`; completion reports failure only when the failure prevents protocol ingestion from continuing. |
| Abort or supersession | Remaining rows are ignored, unresolved holes reject with an internal abort reason (`isPayloadDecodeAborted`), and completion reports `aborted`. |
| Late `data` or asset row after authority is lost | The generation-guarded capability rejects it; it cannot mutate the store or insert assets. |
