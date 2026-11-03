---
packages:
  "@bgub/fig":
    type: patch
  "@bgub/fig-dom":
    type: minor
  "@bgub/fig-reconciler":
    type: patch
  "@bgub/fig-server":
    type: minor
  "@bgub/fig-tanstack-start":
    type: minor
---

## Stream Suspense boundary data ahead of each reveal

Server stream renders now send the data each Suspense boundary read in a `d`
operation right before that boundary's reveal, and `hydrateRoot` applies it to
the root's store. Late boundaries hydrate from server data instead of
reloading in the browser. Streamed rows fill only entries the client has no
value for. Disable with `streamData: false` or exclude entries with
`streamData: { filter }`.

`takeData()` on stream results returns the settled entries that have not been
streamed, so documents can place the shell's snapshot before the client
bootstrap without duplicating later rows.

The TanStack Start transport no longer waits for every boundary before the
router bootstrap. It uses the renderer's streamed rows, streams initial
Payload responses ahead of the boundaries that render them, and lets Router's
deferred data interleave with streamed boundaries.
