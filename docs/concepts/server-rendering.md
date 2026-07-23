# Server Rendering

Status: stable

Fig's server renderer writes Web `ReadableStream`s, works across runtimes, and treats streaming and static output as two different semantics.

## Entry Points

|          | Stream                   | Buffered string        |
| -------- | ------------------------ | ---------------------- |
| Fragment | `renderToStream`         | `renderToHtml`         |
| Document | `renderToDocumentStream` | `renderToDocumentHtml` |

Stream calls return immediately with an object containing `stream`, readiness promises, the request data store, cancellation, content type, and snapshot helpers:

```ts
{
  stream,
  shellReady,
  headReady?,
  allReady,
  data,
  getHead?,
  getData,
  abort,
  contentType,
}
```

A shell failure rejects `shellReady` and errors the stream. There is no callback-only error channel and no promise that delays access to the stream.

A basic request handler looks like this:

```tsx
export async function handleRequest(): Promise<Response> {
  const result = renderToDocumentStream(<App />);

  await result.shellReady;

  return new Response(result.stream, {
    headers: { "content-type": result.contentType },
  });
}
```

Waiting for `shellReady` lets the handler catch a fatal shell error before committing the HTTP response. The stream object itself exists immediately.

Fragment mode collects head content through `getHead()` and `headReady`. Document mode requires the root to render `<html>` and `<head>` and writes assets directly into that document. Its head begins with the early-event capture script. Every framework-owned script carries `data-fig-hydration-skip` so full-document hydration knows it has no application fiber.

The `data` handle belongs to this request. Passing `dataStore` adopts a store populated before rendering by route loaders; the renderer does not copy it. `initialData` remains the simpler option when no store exists yet. The render owns disposal of an adopted store.

`renderToHtml` buffers the exact streamed output after `allReady`, including reveal scripts. It is useful for response caching and snapshots, but it is not React's settled `renderToString`.

Function components may return promises. The renderer invokes the component once, retains that promise as a child slot, and resumes the slot through normal streaming when it resolves.

## Prerender

`prerender(node, { document? })` waits for every server task before it emits HTML. Completed Suspense content therefore appears in its logical position and no reveal runtime is needed.

It returns `{ html, head, data }` and is Fig's static-generation primitive.

- The head is sealed only after content settles, so it describes the final visible tree.
- A failed boundary writes the same client-render marker and fallback shape that streaming would produce.
- Aborting after the shell produces static fallbacks. Aborting before the shell rejects.
- A source that never settles will keep prerender pending, so callers should pass a signal.

## Error Contract

HTML and Payload server errors use one callback:

```ts
onError(error, info) => ({ digest, message })
```

The returned object is the only error information sent to the client. Production sends nothing by default; development includes the message. A recoverable boundary writes a client-render marker, while a fatal shell error rejects the readiness promises.

`@bgub/fig-server/html` exports `escapeText`, `escapeAttribute`, `escapeScriptText`, and `escapeScriptJson` for framework-owned companion markup. Script escaping replaces `<` and JavaScript line separators so data cannot end a `<script>` block or change executable source parsing.

## Adjacent Text

The browser merges neighboring HTML text into one DOM node, but Fig may have separate text fibers on either side of a component or promise slot. The server inserts `<!--,-->` only where two separate text writes would otherwise touch:

```tsx
<div>
  {"Hi "}
  <Name />
</div>
```

Hydration skips comments whose content is exactly `,`. It never skips Suspense markers. A resumed segment that ends in text also writes a trailing separator because it cannot know what will later touch that splice point.

## How Streaming Works

Suspense writes a fallback first when needed. Completed content arrives later in hidden staging nodes, and nonce-bearing inline operations move it into place. See [Suspense streaming](./suspense-streaming.md) for the marker format.

The shell head describes the visible fallback branch. When primary content changes title or metadata, its completion operation carries the complete new visible snapshot. Fallback removal, content reveal, and metadata update happen together. Partial segments never publish metadata.

Each flush pass becomes one encoded stream chunk, and every chunk ends on complete HTML markup. Frameworks may safely interleave bootstrap or Payload frames between chunks.

Suspended work has its own task and render scope. A task retains provider values, id path, host ancestors, select state, component stack, and enclosing hidden Activity. When it resumes, it writes into a child segment at the original cursor. Siblings continue rendering while it waits.

This guarantees that resumed output—including ids and context values—matches a render where the promise had already been settled.

`<pre>` and `<textarea>` preserve their parser-sensitive leading newline according to logical flush order, not the order async work happened to finish.

## Flow Control

Streams honor consumer backpressure through a byte-sized `highWaterMark`, which defaults to 65,536 and is clamped to at least 1.

When the queue reaches that mark, Fig pauses writing between boundary flushes. It never splits one complete-markup chunk. Rendering itself continues, and `shellReady`, `headReady`, and `allReady` settle independently of whether the consumer is reading.

If work settles while output is blocked, the next flush sees the newer state. A boundary that would have needed several partial operations may therefore collapse into one staged completion. With a completely stalled consumer, output naturally approaches the prerender shape while producing the same final DOM.

Cancelling the stream aborts rendering and drops unsent output. Calling `abort(reason)` while a consumer remains active instead writes client-render operations for boundaries that are still pending.

## Content Security Policy

Streaming uses inline scripts for the reveal runtime, boundary operations, and early event capture. Pass a per-request `nonce` to the renderer and include the same nonce in the response's CSP header. Registry-generated scripts and links receive it too.

Nonce is the one supported CSP mechanism. Fig does not maintain a second external streaming runtime, and static hashes cannot cover per-render operation scripts.

Fragment `prerender` is completely script-free. Document output always includes early event capture, even when prerendered. A streaming render whose tree settles before the shell needs no reveal runtime.

Frameworks that interleave their own scripts must use the same nonce and the escaping helpers above.

## Render-Tree Collection

Passing `renderTree: createRenderTreeCollector()` records the component structure as the server renders. Suspended tasks retain their collector parent, so resumed content appears under the correct boundary.

The caller owns the collector and may read it before rendering finishes. This lets a later DevTools panel inspect everything rendered earlier without a second pass.

The server records component names, kinds, keys, and props without children. It does not invent client-only hook state, lanes, or fiber ids. After the client commits, consumers replace the server snapshot with the live DevTools data.

Without a collector, normal renders pay only for copying a null pointer into forked tasks.
