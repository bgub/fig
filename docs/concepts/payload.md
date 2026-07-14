# Payload

Status: stable API; wire encoding internal

Fig's server-component wire layer. The terminology rule: it is **payload**, never "RSC" or "Flight"; those are React brands and the format is Fig's own.

Payload is a **data format, not an architecture**. A server serializes a rendered component tree into a stream of rows; a client decodes that stream back into renderable elements. Everything above the format — endpoints, refresh policy, caching, hydration timing — belongs to the data layer and frameworks (see data.md and `docs/plans/serialized-components.md`). Core keeps the format; frameworks own the wire.

## Homes

- `@bgub/fig/payload` — the browser-safe client half: `decodePayloadStream`, its result/options types, and the single `ResolveClientReference` integration seam. Rows, codecs, and graph encoding are implementation details. Browser code never imports `@bgub/fig-server` to decode.
- `@bgub/fig-server/payload` — the server half: `renderToPayloadStream` and its result/options types.
- `@bgub/fig` — `clientReference`, the one escape hatch for interactivity inside a serialized tree.
- `@bgub/fig-dom` — `payloadDataLoader`, the web adapter that turns a payload endpoint into an ordinary data-resource loader: HTTP/content-type validation, `insertAssetResources` as `prepareAssets`, the store's generation-guarded hydration capability, and the generation-lifetime signal wired into `decodePayloadStream` (data.md).
- `@bgub/fig-start` — owns the private inline-script frame transport used to carry initial-document payload bytes and data hydration through streamed HTML.

## Wire Format

Payload is internally represented as semantic rows and currently encoded as:

- id: `json`
- MIME: `text/x-fig-payload; codec=json; charset=utf-8`
- encoding: newline-delimited JSON rows

The row types and codec are not public APIs. Producer and consumer negotiate the fixed content type at the HTTP boundary, while Fig remains free to replace the encoding without exposing codec machinery to applications.

Ids minted by `useId` during payload render use the `fig-pl-` prefix. Row tags:

- `model` — a serialized tree chunk (id 0 is the root). Trees serialize as `$fig`-tagged nodes: elements, fragments, suspense, and outlined `lazy`/`promise` references that suspend-and-fill by row id.
- `client` — a client reference: `{ id, exportName?, assets?, ssr? }`.
- `data` — settled data-resource hydration entries encoded with the payload value codec (see data.md).
- `assets` — stream-safe asset descriptors (see assets.md), plus an optional `for`: the row id whose reveal depends on these assets. The owning row is decided at serialization scope exit: a subtree that completes keeps its assets with the row it inlines into, while one that suspends or fails takes the assets discovered inside it to its outlined row — so a stylesheet belonging to a streamed hole never gates the enclosing tree's reveal. Scope exits happen within the same synchronous serialization attempt, so association costs no preload latency.
- `error` — `{ digest?, message? }` under the server `onError` contract; the referenced chunk rejects with a digest-carrying error.

There is deliberately no refresh row: the refresh unit is the data-resource key that delivers the payload (data.md), so a refresh is simply a new request for the same stream.

Deliberately absent from the row model: server actions and temporary references. The internal byte encoding may change; no binary encoding exists today.

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

The same internal value encoding backs payload data rows and Fig Start's remote data transport, so both preserve the same value fidelity.

## Server Components Are Render-Only

The server/client line is statefulness, not reads. During `renderToPayloadStream`, the read verbs are server-safe — `readContext`, `readPromise`, `readData` (the render has a per-request store; a pending read suspends that subtree into an outlined streaming hole) — along with `useMemo` and `useId`, and `useSyncExternalStore`'s `getServerSnapshot` path (a read, not a subscription). State, effects, and interactivity **throw at dev time**: `useState`, `useActionState`, `useTransition`, `useStableEvent`, `useReactive`, `useBeforePaint`, `useBeforeLayout`. A serialized component never re-runs on the client, so those APIs would silently freeze initial state into the wire. Event and bind props are functions and already fail serialization. Interactivity belongs to client references.

Context is render-scoped and erased by serialization: `renderToPayloadStream(<SessionContext value={session}><Post /></SessionContext>)` is the idiomatic request-state injection, `readContext` resolves at render time, and nothing context-shaped crosses the wire — every function component has already run. Client context reaches client-reference islands, not the serialized tree itself: islands are real client components and read context from wherever the decoded tree sits, so `{post}` rendered under a client `ThemeProvider` themes every island inside the post. Server-tree-provides-context-to-islands is deliberately unsupported: pass props to the reference, or wrap the island in a client provider component.

## Client References

`clientReference({ id, assets?, ssr? })` marks a component that serializes as a reference instead of rendering on the server. Ids are opaque unique keys; Fig's bundler tooling authors them as `"<module>#<export>"`, and only the server splits that convention — it derives `exportName` once at serialization, so resolvers and the client never string-parse ids. `resolveClientReference(reference)` receives `{ id, exportName?, ssr?, assets? }` as soon as the reference row arrives and returns a component, a promise for one, or `undefined`. Async resolution starts at row arrival so module fetches overlap the stream; a synchronous component preserves element-type identity across decodes. `ssr`-capable references server-render through their registered server component when a server-side decode resolves them (Fig Start's document path).

## Server API

`renderToPayloadStream(node, { onError?, clientReferenceAssets?, dataPartition?, highWaterMark?, signal? })` returns `{ stream, allReady, contentType, abort(reason?) }`. `signal` and `abort()` cancel hung payload renders and reject `allReady`. Error rows follow the `onError → { digest?, message? }` contract (errors.md). Streams respect consumer backpressure with the same contract as the HTML renderer (server-rendering.md Flow Control): rendering and `allReady` are task-driven, row flushing pauses at the byte high-water mark (default 65536) and resumes on pulls, gated between rows so every chunk stays one-or-more complete wire rows.

Fig Start's private inline frame transport carries initial-document payload bytes between HTML chunks. It installs a replayable `{ q, p, s }` queue, emits JSON carrier scripts plus push scripts, and recovers frames when the client bundle runs mid-stream. This is framework delivery machinery, not part of either payload package's public interface.

## Client API: `decodePayloadStream`

`decodePayloadStream(stream, { signal?, hydrate?, resolveClientReference?, prepareAssets? })` is the renderer-neutral client half. It returns a live `PayloadDecode`, ingests rows in the background, and aborts on the generation-lifetime signal:

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
- `abort(reason?)` is idempotent: remaining rows are ignored, unresolved holes reject with an internal cancellation reason, and completion reports `aborted`. Content whose row already arrived but is waiting on an asset gate reveals instead of rejecting.
- `PayloadDecode` deliberately does not implement `PromiseLike`: thenable assimilation would discard `completion` and `abort` when returned through an `async` loader.
- `hydrate(entries)` receives decoded `data` rows. The capability is expected to be generation-guarded by its supplier: it hydrates through the calling store only while that load generation is authoritative and ignores entries after supersession (data.md).
- `prepareAssets(assets)` is called with stream-safe asset resources as soon as their rows arrive (fig-dom's `insertAssetResources` is the intended web implementation). A returned promise gates the reveal of only the content that declared a dependency — the row named by an assets row's `for`, or the island referencing a `client` row's own assets. Gate settlement (fulfilled _or_ rejected) releases the reveal; a failed asset never blocks content.
- A reference resolved synchronously with no asset gate decodes to the component itself, so its element type is identity-stable across decodes: re-decoding a surrounding payload updates the client component in place and its state survives. Gated or asynchronously resolved references decode to per-decode wrapper components and remount on re-decode — unless the decode is given a `clientReferenceCache` (from `createPayloadClientReferenceCache`), which makes every resolvable reference decode to one cache-owned wrapper per reference id across all decodes sharing the cache (gated or not).
- Identity lives on the component type; the asset dependency lives on the element instance. Each decode attaches its still-unsettled reveal gate to the client-referencing elements it materializes, and the reference wrapper reads the gate per element at render. So concurrent or later decodes gate exactly their own content: a newer decode's pending assets can never re-suspend an island already on screen (the previous decode's elements), and new island instances wait for the stylesheets they declared even when their reference id is already warm in the cache. Elements minted outside a decode from a cached component carry no gate and render ungated — they declared no dependency.
- The caller owns the cache's lifetime, but under a fast-refresh bundler contract no manual invalidation is needed: the latched resolution is no stickier than an ESM import binding — hot edits remap the latched function through its component family, and updates the bundler cannot accept escalate to a full reload, which resets the cache with the page (pinned by a test in fig-dom's refresh suite). `delete`/`clear` serve lifetimes outside that contract, e.g. swapping a manifest without reloading. Unresolvable references are never cached, so a decode configured without a resolver cannot poison a shared cache. Use one cache per resolver.
- Asynchronous client-reference resolution starts at row arrival and overlaps the stream. A resolution failure rejects the referencing decoded component when it renders — through whatever `ErrorBoundary` covers it — and fails completion only when it prevents protocol ingestion from continuing.

### Failure Semantics

| Failure | Observable result |
| --- | --- |
| Transport, codec, or protocol failure before the root row | `decode.value` rejects; `completion` resolves `{ status: "failed", error }`. |
| `error` row for the root | `decode.value` rejects with the digest-carrying error; ingestion itself completes. |
| `error` row belonging to an outlined hole | That hole rejects; the nearest `ErrorBoundary` covering that decoded slot handles it (digest contract intact). The fulfilled root value remains published. |
| Truncated or malformed stream after the root row | Every unresolved hole rejects with the transport/protocol error and propagates through its nearest `ErrorBoundary`; `completion` resolves `{ status: "failed", error }`; the fulfilled value stays published. |
| Client-reference resolution failure | The referencing decoded component rejects through its nearest `ErrorBoundary`; completion reports failure only when the failure prevents protocol ingestion from continuing. |
| Abort or supersession | Remaining rows are ignored, unresolved holes reject with an internal cancellation reason, and completion reports `aborted`. |
| Late `data` or asset row after authority is lost | The generation-guarded capability ignores it; it cannot mutate the store or insert assets. |
