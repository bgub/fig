# Payload

Status: stable API; wire encoding internal

Fig's server-component wire layer. The terminology rule: it is **payload**, never "RSC" or "Flight"; those are React brands and the format is Fig's own.

Payload is a **data format, not an architecture**. A server serializes a rendered component tree into a stream of rows; a client decodes that stream back into renderable elements. Everything above the format — endpoints, refresh policy, caching, hydration timing — belongs to the data layer and frameworks (see data.md). Core keeps the format; frameworks own the wire.

## Homes

- `@bgub/fig/payload` — the browser-safe client half: `decodePayloadStream`, its result/options types, and the single `ResolveClientReference` integration seam. Rows, codecs, and graph encoding are implementation details. Browser code never imports `@bgub/fig-server` to decode.
- `@bgub/fig-server/payload` — the server half: `renderToPayloadStream` and its result/options types.
- `@bgub/fig` — `clientReference`, the one escape hatch for interactivity inside a serialized tree.
- `@bgub/fig-dom` — `payloadDataLoader`, the web adapter that turns a payload endpoint into an ordinary data-resource loader: HTTP/content-type validation, `insertAssetResources` as `prepareAssets`, the store's generation-guarded hydration capability, and the generation-lifetime signal wired into `decodePayloadStream` (data.md).
- `@bgub/fig-tanstack-start` — the framework transport for carrying initial-document Payload bytes through streamed HTML. Applications declare the serving/cache seam with `payloadResource`; its compiler generates the low-level `renderPayloadResponse` call.

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
- `assets` — asset descriptors (see assets.md), plus an optional `for`: the row id that owns them. The owning row is decided at serialization scope exit: a subtree that completes keeps its assets with the row it inlines into, while one that suspends or fails takes the assets discovered inside it to its outlined row — so a stylesheet belonging to a streamed hole never gates the enclosing tree's reveal, and metadata cannot publish before that owner commits. Scope exits happen within the same synchronous serialization attempt, so association costs no preload latency.
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

It rejects functions, class instances/non-plain objects, and non-global symbols. Payload-rendered values can additionally contain Fig elements, client references, and promises; those are serialized by the payload renderer into row references before the value codec handles ordinary data. Nested containers recurse through the same serializer rather than becoming opaque values, so any new container/value type must ship with tests nesting client references, promises, Payload-rendered elements, shared objects, and cycles inside it.

The `$fig: "promise"` reference has two typed producer paths with one wire shape. A promise in an ordinary prop is a value promise, so its resolved value returns through value serialization. A promise in a tree position is a node promise, so its resolved value returns through node serialization: elements render normally, portals erase, nested promises outline again, and invalid child objects produce an `error` row instead of crossing as data. The decoder intentionally exposes both as ordinary thenables; the receiving prop or child position supplies the meaning.

The model format carries request-wide object ids. The first occurrence of a supported graph object defines it inline; later occurrences in the same payload request use a graph reference. Definitions always precede references in the row stream, so a streaming decoder never sees a dangling reference in a well-formed stream.

The same internal value encoding backs payload data rows and the TanStack Start document-data carrier, so both preserve the same value fidelity.

## Payload-Rendered Components Are Render-Only

The server/client line is statefulness, not reads. During `renderToPayloadStream`, the read verbs are server-safe — `readContext`, `readPromise`, `readData` (the render has a per-request store; a pending read suspends that subtree into an outlined streaming hole) — along with `useMemo` and `useId`, and `useSyncExternalStore`'s `getServerSnapshot` path (a read, not a subscription). A component may also return a promise/come from an `async` function: the serializer invokes it once, outlines that exact promise as a node-promise row, and attaches the component's scoped assets and error stack to that row. State, effects, and interactivity **throw at dev time**: `useState`, `useActionState`, `useTransition`, `useStableEvent`, `useReactive`, `useBeforePaint`, `useBeforeLayout`. A serialized component never re-runs on the client, so those APIs would silently freeze initial state into the wire. `bind` props are functions and already fail serialization. A host element's `mix` resolved into its props at element creation, so the serializer strips the marker from host props and ships server-safe results such as aria and styling; client-only behavior such as `on()` throws instead of disappearing from the payload. `mix` passed to a component still fails serialization like any function-bearing prop. Interactivity belongs to client references.

Context is render-scoped and erased by serialization: `renderToPayloadStream(<SessionContext value={session}><Post /></SessionContext>)` is the idiomatic request-state injection, `readContext` resolves at render time, and nothing context-shaped crosses the wire — every function component has already run. Client context reaches client-reference islands, not the serialized tree itself: islands are real client components and read context from wherever the decoded tree sits, so `{post}` rendered under a client `ThemeProvider` themes every island inside the post. Server-tree-provides-context-to-islands is deliberately unsupported: pass props to the reference, or wrap the island in a client provider component.

## Client References

`clientReference({ id, assets?, ssr? })` marks a component that serializes as a reference instead of rendering on the server. Ids are opaque unique keys; Fig's bundler tooling authors them as `"<module>#<export>"`, and only the server splits that convention — it derives `exportName` once at serialization, so resolvers and the client never string-parse ids. `resolveClientReference(reference)` receives `{ id, exportName?, ssr?, assets? }` as soon as the reference row arrives and returns a component, a promise for one, or `undefined`. Async resolution starts at row arrival so module fetches overlap the stream; a synchronous component preserves element-type identity across decodes. `ssr`-capable references server-render through their registered server implementation when a server-side decode resolves them.

This is the low-level format seam, not the Fig TanStack Start authoring model. A `payloadResource` render callback Payload-renders its ordinary component tree regardless of source filenames; the compiler lowers that boundary to `renderPayloadResponse`. Start applications conventionally keep the shared resource declaration in `.payload.tsx`, but the filename does not cause Payload rendering. Start applications use `<Isomorphic component={Counter} ... />` at the exceptional hydration boundary; the compiler turns that static import into a reference, generates its server/browser manifest, owns the shared resolver, and supplies its CSS assets. Start users do not call these low-level APIs.

## Server API

`renderToPayloadStream(node, { onError?, componentAssets?, clientReferenceAssets?, dataPartition?, highWaterMark?, signal? })` returns `{ stream, allReady, contentType }`. Cancellation is signal-only, matching the decoder: aborting `signal` (or cancelling the stream) cancels a hung payload render and rejects `allReady`. A result `abort()` method existed and was removed (2026-07) — on the payload side it was a third spelling of the same cancellation, unlike the HTML renderer's `abort()`, which has distinct semantics (delivering client-render ops for pending boundaries to a live consumer) and stays. Error rows follow the `onError → { digest?, message? }` contract (errors.md). Streams respect consumer backpressure with the same contract as the HTML renderer (server-rendering.md Flow Control): rendering and `allReady` are task-driven, row flushing pauses at the byte high-water mark (default 65536) and resumes on pulls, gated between rows so every chunk stays one-or-more complete wire rows. Bundler-provided `componentAssets(type)` values enter the same pending-asset scope as an explicit `assets(...)` declaration, so suspension assigns them to the correct outlined row and ordinary Payload dedupe and reveal gating apply.

Framework-private document transports carry initial Payload bytes through streamed HTML. The TanStack Start adapter collects each initial Payload response concurrently with shell HTML and emits one keyed, non-executable carrier immediately before TanStack's hydration barrier. This is framework delivery machinery, not part of either payload package's public interface.

## Client API: `decodePayloadStream`

`decodePayloadStream(stream, { signal?, hydrate?, resolveClientReference?, prepareAssets?, retainAssets?, onHoleError?, onStreamDone? })` is the renderer-neutral client half. It returns `Promise<AwaitedFigNode>` (`AwaitedFigNode` is `FigNode` without a top-level promise), ingests rows in the background, and cancels through the generation-lifetime `signal` — there is no separate handle: an `async` loader returns the promise directly and thenable assimilation loses nothing.

- The returned promise resolves when the root row (id 0) decodes, while decoding continues in the background; unfinished subtrees inside it are outlined holes or promise children that suspend and fill (or reject) as their rows arrive. It rejects only when the stream fails before producing a root value, or with the root row's own `error` row. A root that is itself a node promise follows normal JavaScript promise assimilation, so the decode promise waits for that node row.
- `onStreamDone({ status: "complete" | "failed" | "aborted", error? })` observes the end of ingestion, called exactly once when the stream settles. Post-root failures propagate to UI by rejecting unresolved decoded holes — a failure cannot retroactively throw through already fully decoded content that no longer has a pending slot — so a failure that strands no hole is observable only here. The callback is never awaited and its exceptions and rejections are swallowed: an observer — sync or async — can neither block nor break decode teardown nor leak an unhandled rejection.
- `onHoleError(error)` observes every outlined hole rejection except cancellation. Like `onStreamDone`, it is never awaited and cannot break decoding. fig-dom uses it behind `payloadDataLoader` to attribute the error to the live owning data-resource generation; ordinary decoder consumers may use it for reporting.
- Aborting `signal` is idempotent: remaining rows are ignored, unresolved holes reject with an internal cancellation reason, and `onStreamDone` reports `aborted`. Content whose row already arrived but is waiting on an asset gate reveals instead of rejecting.
- `hydrate(entries)` receives decoded `data` rows. The capability is expected to be generation-guarded by its supplier: it hydrates through the calling store only while that load generation is authoritative and ignores entries after supersession (data.md).
- `prepareAssets(assets)` is called only with stream-destined delivery assets as soon as their rows arrive (fig-dom's `insertAssetResources` is the intended web implementation). A returned promise gates the reveal of only the content that declared a dependency — the row named by an assets row's `for`, or the island referencing a `client` row's own assets. Gate settlement (fulfilled _or_ rejected) releases the reveal; a failed asset never blocks content. Title/meta never enter this imperative path.
- Head-destined metadata is always reattached as an `assets(...)` declaration around the row or client-reference instance that declared it, so only the owner's renderer commit can publish it. `retainAssets: true` retains delivery assets there too. Server document renderers use that mode so a streamed stylesheet is emitted immediately before its dependent HTML segment, including late outlined holes; browser decoders normally prepare delivery assets imperatively and retain only metadata.
- A reference resolved synchronously with no asset gate decodes to the component itself, so its element type is identity-stable across decodes: re-decoding a surrounding payload updates the client component in place and its state survives. Gated or asynchronously resolved references decode to per-decode wrapper components and remount on re-decode — unless `resolveClientReference` is a stateful resolver (from `createPayloadClientReferenceResolver(resolve)`), which makes every resolvable reference decode to one resolver-owned wrapper per reference id across all decodes sharing the resolver (gated or not).
- The wrapper attaches the reference's retained asset declarations above its suspension points (the pending module resolution and the reveal gate), so a renderer delivers them with the segment that contains the reference even when the content itself streams as a late fill. A server document render that hits a cold reference module therefore emits the island's stylesheet with the same ordering as a warm one.
- Identity lives on the component type; the asset dependency lives on the element instance. Each decode attaches its still-unsettled reveal gate to the client-referencing elements it materializes, and the reference wrapper reads the gate per element at render. So concurrent or later decodes gate exactly their own content: a newer decode's pending assets can never re-suspend an island already on screen (the previous decode's elements), and new island instances wait for the stylesheets they declared even when their reference id is already warm in the resolver. Elements minted outside a decode from a cached component carry no gate and render ungated — they declared no dependency.
- The caller owns the resolver's lifetime, but under a fast-refresh bundler contract no manual invalidation is needed: the latched resolution is no stickier than an ESM import binding — hot edits remap the latched function through its component family, and updates the bundler cannot accept escalate to a full reload, which resets the resolver with the page (pinned by a test in fig-dom's refresh suite). `delete`/`clear` serve lifetimes outside that contract, e.g. swapping a manifest without reloading. Unresolvable references are never latched, so a resolver that cannot resolve a reference yet is not poisoned for later decodes that can. Identity deliberately lives on the resolver rather than a separate cache option (folded 2026-07): the split carried a "one cache per resolver" pairing rule and factory-provenance validation that the merged seam makes structural.
- `resolveClientReference(reference)` deliberately receives the full decoded reference: `{ id, exportName?, ssr?, assets? }` mirrors the `client` row's wire fields, and the reference object is how the format layer hands delivery metadata to adapters. Narrowing the callback to an opaque id would hide format-owned export, rendering, and asset metadata and force adapters to recover it out-of-band.
- Asynchronous client-reference resolution starts at row arrival and overlaps the stream. A resolution failure rejects the referencing decoded component when it renders — through whatever `ErrorBoundary` covers it — and fails the stream result only when it prevents protocol ingestion from continuing.

Each decode materializes fresh element objects; ordinary keys and reconciliation preserve component identity across resource refreshes. Request-local row and graph ids are allocation details, not cross-refresh identity. Migration benchmarks found decoding dominated refresh cost and ordinary keyed reconciliation was acceptable, so Fig deliberately carries no decoded-chunk memoization or other cross-refresh identity protocol. Revisit only if a real profile shows reconciliation rather than decoding dominating.

### Failure Semantics

| Failure | Observable result |
| --- | --- |
| Transport, codec, or protocol failure before the root row | The decode promise rejects; `onStreamDone` reports `{ status: "failed", error }`. |
| `error` row for the root | The decode promise rejects with the digest-carrying error; ingestion itself completes. |
| `error` row belonging to an outlined hole | That hole rejects; the nearest `ErrorBoundary` covering that decoded slot handles it (digest contract intact). The fulfilled root value remains published. |
| Truncated or malformed stream after the root row | Every unresolved hole rejects with the transport/protocol error and propagates through its nearest `ErrorBoundary`; `onStreamDone` reports `{ status: "failed", error }`; the fulfilled value stays published. |
| Client-reference resolution failure | The referencing decoded component rejects through its nearest `ErrorBoundary`; `onStreamDone` reports failure only when the failure prevents protocol ingestion from continuing. |
| Abort or supersession | Remaining rows are ignored, unresolved holes reject with an internal cancellation reason, and `onStreamDone` reports `aborted`. |
| Late `data` or asset row after authority is lost | The generation-guarded capability ignores it; it cannot mutate the store or insert assets. |
