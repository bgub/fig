# Server Rendering

Status: stable

The streaming model, the entry-point grid, prerender, and the error contract.

## The Entry Grid

`render + To + (Document?) + output form`:

|          | stream                   | buffered string        |
| -------- | ------------------------ | ---------------------- |
| fragment | `renderToStream`         | `renderToHtml`         |
| document | `renderToDocumentStream` | `renderToDocumentHtml` |

Streams are Web `ReadableStream`s (same shape across Node, edge, Deno, Bun). Results return **synchronously** — `{ stream, shellReady, headReady?, allReady, data, getHead()?, getData(), abort(), contentType }` — no shell-gated promise. A shell failure rejects `shellReady` (and errors the stream); there is no callback channel. Fragment mode exposes the collected head (`getHead()`/`headReady`); document mode owns the head and injects it itself (the root must render `<html>` with a `<head>`). Document heads open with the inline early-event-capture script so pre-bundle interactions replay after hydration (events.md).

`data` is the request-scoped store handle. `dataStore` adopts a root-neutral store already populated by request or route loaders; the renderer uses that same store rather than copying a snapshot into a second cache. `initialData` remains the value-only hydration option when no pre-created store is needed. A supplied store is owned and disposed by the render lifecycle.

`renderToHtml` is honestly "the streamed output, buffered": it awaits `allReady` and concatenates exactly the bytes a streaming client would have received — including the inline runtime and reveal scripts when the tree suspends past the shell. Right for caching responses and snapshotting wire output; it is **not** React's `renderToString`.

## Prerender

`prerender(node, { document? })` is the settled static semantic: it holds all flushing until every task settles, generalizing the flush-time content-vs-fallback choice — boundaries only enter the op-writing queues once their parent has flushed, so with nothing flushed before `pendingTasks` reaches zero, every boundary inlines in logical position and no streaming runtime is ever written. Returns `{ html, head, data }` — the SSG primitive.

- Head sealing defers to flush, so head assets discovered inside suspended content land in the head (streaming mode would have warned).
- Server-failed boundaries emit the static client-render shape — marker comment plus `<template data-dgst data-msg>` plus fallback — byte-identical to what the streamed `x` op produces after mutation, so prerendered pages hydrate and retry failed boundaries client-side.
- Aborting after the shell resolves with static fallbacks; before the shell, it rejects. A hung data source hangs the prerender — pass `signal`.

## The Error Contract

Server render errors cross the wire only through `onError(error, info) => { digest?, message? }` — the handler's payload is authoritative; production defaults to empty, development includes the message. Shared by the HTML renderer and the payload renderer (payload errors never re-execute on the client, so the wire is their only surface). Recoverable boundary errors become client-render markers carrying the digest; fatal shell errors reject the readiness promises. `escapeAttribute`/`escapeText` export from `@bgub/fig-server/html` for frameworks writing companion inline scripts.

## Text Separators

Adjacent text that comes from different fibers — `<div>{"Hi "}<Name/></div>`, text around a component that renders nothing, a resumed suspended segment whose seams touch text — is emitted with a `<!--,-->` comment between the two text writes: the browser's parser would otherwise merge them into a single DOM text node while the client tree keeps one text fiber per normalized child (`collectChildren` merges adjacent strings only within one children array). Separators are emitted only where two text writes would actually touch (element tags and Suspense/Activity markers already break adjacency), plus a trailing separator when a resumed segment ends in text — it cannot know what follows its splice point. fig-dom's hydration cursor skips comments whose data is exactly `,` when advancing (and only those; suspense markers are never skipped). Browsers ignore leftover separators at runtime.

## Streaming Mechanics

Suspense streams fallbacks first; completed content and partial segments follow as hidden staging nodes moved into place by a nonce-compatible inline runtime (no external runtime format) — see suspense-streaming.md for the marker/op protocol. Writes buffer per flush pass and leave as one encoded enqueue, and every flushed chunk ends on complete markup — injecting between chunks is parse-safe, a contract the demos' bootstrap and payload-frame interleaving rely on. `identifierPrefix` scopes generated ids; `nonce` flows to every inline script.

Suspended work is task-scoped: every children array renders under a per-child thenable catch, so a suspension can only escape a node before that node has written anything — no write truncation exists or is needed. The spawned task forks the render scope at the suspension point (cloned provider values, id-path position plus the child's original index, host-ancestor stack, select context, component stack, enclosing hidden-activity id), and a retry renders into a child segment spliced at the parent's cursor. A suspension in one child never blocks starting later siblings, and resumed output — ids and provider values included — is byte-identical to the never-suspending render.

## Flow Control

Streams respect consumer backpressure. The result stream carries a byte-length queuing strategy (`highWaterMark` option, default 65536 bytes, clamped to ≥ 1); once the internal queue reaches the mark, op-writing pauses **between boundary flushes** — never mid-chunk, so the complete-markup chunk contract holds — and the stream's pull handler resumes flushing as the consumer reads. Rendering itself never pauses: task progress is data-driven, and `shellReady`/`headReady`/`allReady` are task-driven, so readiness settles identically for an unread stream (`renderToHtml` and `prerender` await `allReady` before reading precisely because of this). The shell flushes ungated — the queue is empty before the first write, and shell latency outranks flow control.

Blocked flushing composes with the flush-time content-vs-fallback choice rather than adding a mode: work that settles while the flow is blocked is seen settled by the next flush pass, so boundaries that would have streamed as partial segments plus fill ops instead coalesce into one staged piece with a single reveal op. A fully blocked stream degrades toward the prerender shape; the assembled DOM is identical either way. Cancelling the stream (`stream.cancel()` / `reader.cancel()`) aborts the render and drops undelivered output; `abort(reason)` with a live consumer still delivers the client-render ops for pending boundaries through subsequent pulls.

## Content Security Policy

The streaming protocol's client side is inline scripts, deliberately: the reveal runtime, the per-boundary op scripts, and document mode's early-event-capture script all ship as inline `<script>` elements, and the `nonce` option threads to every one of them (and to registry-emitted `<script>`/`<link>` asset tags). Under a CSP that restricts `script-src`, generate a per-request nonce, pass it to the render, and include it in the response header — **nonce is the one CSP mechanism; there is intentionally no external-runtime option** (React ships an external Fizz runtime for nonce-less strict CSP). An external runtime would mean a second wire format driven by DOM mutation observation, a versioned runtime asset to serve, cache, and keep compatible across releases, and a second implementation of every op — permanent surface for a constraint the platform already solves with nonces. Static `script-src` hashes cannot cover the op scripts either (they are per-render dynamic), so nonce-less strict CSP and streamed Suspense are simply incompatible in Fig.

The script-free tiers: fragment-mode `prerender` emits no scripts at all; document-mode output — `prerender` included — always opens `<head>` with the one early-event-capture inline script (nonce-carrying), and a render whose tree settles before the shell flushes never writes the reveal runtime. Framework layers interleaving companion inline scripts (bootstrap, payload frames) must apply the same nonce; `escapeAttribute`/`escapeText` export from `@bgub/fig-server/html` for exactly that kind of companion markup.

## Render-Tree Collection

`renderTree: createRenderTreeCollector()` on any render entry makes the renderer record the component structure as it renders — one node per element or text child (name, kind, key, props minus children), attached through a `treeParent` pointer forked into suspended tasks so resumed content lands under its boundary. The collector is caller-owned and readable mid-render: a subtree later in document order (a DevTools panel in an aside) sees everything rendered before it, which is how introspection UI prerenders without a second pass. Hooks, lanes, and fiber ids are client-runtime facts the server never fabricates; consumers converting the tree into a DevTools snapshot replace it with the live hook after the client's first commit. With no collector passed, the threading is a null pointer copy per fork — plain renders record nothing.
