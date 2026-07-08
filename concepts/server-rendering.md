# Server Rendering

Status: stable

The streaming model, the entry-point grid, prerender, and the error contract.

## The Entry Grid

`render + To + (Document?) + output form`:

|          | stream                   | buffered string        |
| -------- | ------------------------ | ---------------------- |
| fragment | `renderToStream`         | `renderToHtml`         |
| document | `renderToDocumentStream` | `renderToDocumentHtml` |

Streams are Web `ReadableStream`s (same shape across Node, edge, Deno, Bun).
Results return **synchronously** — `{ stream, shellReady, headReady?,
allReady, getHead()?, getData(), abort(), contentType }` — no shell-gated
promise. A shell failure rejects `shellReady` (and errors the stream); there
is no callback channel. Fragment mode exposes the collected head
(`getHead()`/`headReady`); document mode owns the head and injects it itself
(the root must render `<html>` with a `<head>`).

`renderToHtml` is honestly "the streamed output, buffered": it awaits
`allReady` and concatenates exactly the bytes a streaming client would have
received — including the inline runtime and reveal scripts when the tree
suspends past the shell. Right for caching responses and snapshotting wire
output; it is **not** React's `renderToString`.

## Prerender

`prerender(node, { document? })` is the settled static semantic: it holds all
flushing until every task settles, generalizing the flush-time
content-vs-fallback choice — boundaries only enter the op-writing queues once
their parent has flushed, so with nothing flushed before `pendingTasks`
reaches zero, every boundary inlines in logical position and no streaming
runtime is ever written. Returns `{ html, head, data }` — the SSG primitive.

- Head sealing defers to flush, so head assets discovered inside suspended
  content land in the head (streaming mode would have warned).
- Server-failed boundaries emit the static client-render shape — marker
  comment plus `<template data-dgst data-msg>` plus fallback — byte-identical
  to what the streamed `x` op produces after mutation, so prerendered pages
  hydrate and retry failed boundaries client-side.
- Aborting after the shell resolves with static fallbacks; before the shell,
  it rejects. A hung data source hangs the prerender — pass `signal`.

## The Error Contract

Server render errors cross the wire only through
`onError(error, info) => { digest?, message? }` — the handler's payload is
authoritative; production defaults to empty, development includes the
message. Shared by the HTML renderer and the payload renderer (payload
errors never re-execute on the client, so the wire is their only surface).
Recoverable boundary errors become client-render markers carrying the digest;
fatal shell errors reject the readiness promises. `escapeAttribute`/
`escapeText` are exported for frameworks writing companion inline scripts.

## Text Separators

Adjacent text that comes from different fibers — `<div>{"Hi "}<Name/></div>`,
text around a component that renders nothing, a resumed suspended segment
whose seams touch text — is emitted with a `<!--,-->` comment between the two
text writes: the browser's parser would otherwise merge them into a single
DOM text node while the client tree keeps one text fiber per normalized child
(`collectChildren` merges adjacent strings only within one children array).
Separators are emitted only where two text writes would actually touch
(element tags and Suspense/Activity markers already break adjacency), plus a
trailing separator when a resumed segment ends in text — it cannot know what
follows its splice point. fig-dom's hydration cursor skips comments whose
data is exactly `,` when advancing (and only those; suspense markers are
never skipped). Browsers ignore leftover separators at runtime.

## Streaming Mechanics

Suspense streams fallbacks first; completed content and partial segments
follow as hidden staging nodes moved into place by a nonce-compatible inline
runtime (no external runtime format) — see suspense-streaming.md for the
marker/op protocol. Writes buffer per flush pass and leave as one encoded
enqueue. `identifierPrefix` scopes generated ids; `nonce` flows to every
inline script.

Suspended work is task-scoped: every children array renders under a per-child
thenable catch, so a suspension can only escape a node before that node has
written anything — no write truncation exists or is needed. The spawned task
forks the render scope at the suspension point (cloned provider values,
id-path position plus the child's original index, host-ancestor stack, select
context, component stack, enclosing hidden-activity id), and a retry renders
into a child segment spliced at the parent's cursor. A suspension in one
child never blocks starting later siblings, and resumed output — ids and
provider values included — is byte-identical to the never-suspending render.
