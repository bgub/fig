# Payload

Status: stable API; wire encoding internal

Payload is Fig's server-component data format. A server renders a component tree into streamed rows; a client decodes those rows back into renderable Fig elements.

It is called **Payload**, never RSC or Flight. Those are React formats and brands.

Payload is a format, not an application architecture. Endpoints, caching, refresh policy, and hydration timing belong to frameworks and [data resources](./data.md).

The common browser flow is:

1. A server endpoint calls `renderToPayloadStream(<Profile />)`.
2. A data-resource loader fetches that stream.
3. `payloadDataLoader` decodes it into a `FigNode` value.
4. A component renders that value with `readData`.
5. Refreshing the data-resource key requests and decodes a replacement tree.

Payload itself only defines steps 1 and 3. The data layer and framework own the rest.

## Package Boundaries

- `@bgub/fig-server/payload` owns `renderToPayloadStream`.
- `@bgub/fig/payload` owns browser-safe `decodePayloadStream` and the client-reference resolver type. Browser code never imports the server package to decode.
- `@bgub/fig` owns `clientReference`, the low-level interactivity escape hatch.
- `@bgub/fig-dom` owns `payloadDataLoader`, which turns a Payload endpoint into a data-resource loader and connects decoding to browser assets and hydration.
- `@bgub/fig-tanstack-start` owns framework transport, `payloadResource`, and its compiler integration.

Rows, codecs, and graph encoding remain internal.

## Wire Format

The current codec is newline-delimited JSON with:

```text
text/x-fig-payload; codec=json; charset=utf-8
```

This MIME type is fixed at the HTTP boundary, but the row shapes and byte encoding are not public APIs. Fig may replace them without changing application code.

Payload `useId` values use the `fig-pl-` prefix. The semantic row kinds are:

- `model` — a serialized tree chunk. Row `0` is the root.
- `client` — a client reference with `{ id, exportName?, assets?, ssr? }`.
- `data` — settled data-resource hydration entries.
- `assets` — descriptors, optionally attached to the row that owns them.
- `error` — `{ digest?, message? }` from the server's `onError` handler.

Assets discovered by a subtree stay with the row where that subtree lands. If the subtree suspends, its stylesheet belongs to the outlined row rather than blocking the enclosing tree. Metadata also stays with its owner until that owner commits.

There is no refresh row. A Payload tree is delivered as a data-resource value, so refreshing its resource key requests a new stream. Server actions and temporary references are also absent.

## Values

Payload is richer than `JSON.stringify`. It supports:

- JSON scalars, arrays, and plain objects;
- `undefined`, `BigInt`, `Date`, `Map`, and `Set`;
- `NaN`, infinities, and `-0`;
- global symbols created with `Symbol.for`;
- shared references and cycles across supported containers; and
- rendered elements, client references, and promises during Payload rendering.

Functions, class instances, other non-plain objects, and non-global symbols are rejected.

Object identity is request-wide. The first occurrence defines an object and later occurrences reference it, so shared and cyclic graphs survive decoding. Definitions always precede their references in a valid stream.

Promises have one wire shape but two meanings. A promise in a prop resolves through value serialization. A promise in child position resolves through node rendering: elements render, portals disappear, nested promises may outline again, and invalid children become error rows.

The decoded result is an ordinary thenable. Its receiving position provides the meaning.

The same value codec backs Payload data rows and TanStack Start's document data, so both preserve the same values.

## Payload Components Are Render-Only

A component rendered through Payload runs on the server and does not run again in the browser. Reads are safe; state and interactivity are not.

Allowed operations include:

- `readContext`, `readPromise`, and `readData`;
- `useMemo` and `useId`;
- the server snapshot side of `useSyncExternalStore`; and
- returning a promise or using an async component.

State, effects, transitions, actions, and stable events throw in development. Otherwise they would silently freeze server state into the wire. `bind` and component-level function-bearing `mix` props fail serialization. Host mixins resolve before serialization, so safe results such as ARIA props remain while client-only `on()` behavior throws.

Context is consumed during server rendering and is not serialized. A client-reference island reads client context from the location where the decoded tree is mounted. To pass server context into an island, use props or a client provider component.

## Client References

`clientReference({ id, assets?, ssr? })` creates a component that serializes as a reference instead of executing in Payload.

Ids are opaque. Fig tooling commonly authors `"<module>#<export>"`, but the server splits that convention once and sends `exportName` separately. Client resolvers never parse ids.

`resolveClientReference(reference)` receives the full decoded object and returns a component, a promise for one, or `undefined`. Resolution starts as soon as the row arrives, overlapping module loading with the rest of the stream. An SSR-capable reference may render through a registered server implementation during server-side decoding.

TanStack Start applications normally use `payloadResource` and `<Isomorphic component={Counter} />` instead. Its compiler creates references, manifests, resolvers, and CSS metadata. A `.payload.tsx` filename is only a convention; the `payloadResource` render callback defines the Payload boundary.

## Server API

```ts
renderToPayloadStream(node, options);
// => { stream, allReady, contentType }
```

Options include error handling, component and client-reference assets, data partitioning, flow control, and cancellation.

Cancellation is signal-only. Aborting the signal or cancelling the stream stops a hung render and rejects `allReady`. Payload has no result-level `abort()` because that would duplicate signal cancellation; HTML rendering keeps its `abort()` because it can still send client-render operations to a live consumer.

The stream uses the same backpressure model as HTML. Rendering and `allReady` continue independently, while row output pauses between complete rows at the byte high-water mark.

Bundler-provided component assets join the same pending scope as explicit `assets()` declarations, so a suspension assigns them to the correct row.

Frameworks may carry initial Payload streams inside HTML. TanStack Start does this with private non-executable carriers before hydration begins; that transport is not part of either Payload package's public API.

## Client API

```ts
decodePayloadStream(stream, options);
// => Promise<AwaitedFigNode>
```

The returned promise resolves when the root row is ready. Decoding continues in the background, so nested holes may still suspend and fill later. It rejects only when the stream fails before the root or the root itself receives an error row.

Important options are:

- `signal` cancels ingestion. Late rows are ignored and unresolved holes receive an internal cancellation reason.
- `hydrate(entries)` receives data rows. The caller should guard it with the owning data-resource generation.
- `prepareAssets(assets)` prepares delivery assets as soon as they arrive. Its promise gates only the content that declared those assets; fulfillment or rejection both release the gate.
- `retainAssets` keeps delivery descriptors attached to decoded owners. Server document decoding uses this; browsers usually retain only metadata.
- `resolveClientReference` resolves client components.
- `onHoleError` observes non-cancellation hole failures.
- `onStreamDone` runs exactly once with `"complete"`, `"failed"`, or `"aborted"`.

Observer callbacks are never awaited. Their own errors and rejected promises are swallowed so reporting cannot break decoder teardown.

Metadata is always retained on its owner and published only by renderer commit. Delivery assets may be prepared eagerly. A client-reference wrapper keeps assets above its module and reveal suspension points, so late content still receives its stylesheet before reveal.

## Reference Identity And Asset Gates

A synchronously resolved, ungated reference decodes to the component itself, preserving type identity across refreshes. Async or gated references need wrappers.

`createPayloadClientReferenceResolver(resolve)` owns one stable wrapper per reference id across every decode that shares the resolver. This lets component state survive repeated Payload refreshes even when resolution or assets are asynchronous.

Unresolvable references are not cached. The resolver exposes `delete` and `clear` for manifest lifetimes outside normal Fast Refresh behavior.

Component identity belongs to the resolver; an asset gate belongs to one decoded element. A newer stream waiting on CSS cannot re-suspend an island already on screen, while every new island waits for the assets it declared.

Each decode creates fresh element objects. Normal keys and reconciliation preserve component identity. Row ids and graph ids exist only within one request. Fig does not maintain cross-refresh decoded-chunk identity because profiling found decoding, not reconciliation, dominated this path.

## Failure Semantics

| Failure | Result |
| --- | --- |
| Transport or protocol failure before root | Decode promise rejects; `onStreamDone` reports failure. |
| Root `error` row | Decode promise rejects with the digest-carrying error. |
| Hole `error` row | That hole rejects into its nearest ErrorBoundary; the root remains published. |
| Failure after root | Every unresolved hole rejects; completed content remains published. |
| Client-reference resolution failure | The referencing component rejects into its nearest ErrorBoundary. |
| Abort or supersession | Remaining rows are ignored, holes cancel, and `onStreamDone` reports aborted. |
| Late data or asset row | The generation guard ignores it. |
