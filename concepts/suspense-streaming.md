# Suspense Streaming Protocol

Status: stable

The wire shape that lets Suspense content stream out of order and complete in
place, and the client runtime that assembles it.

## Markers

A server-rendered Suspense boundary brackets its slot with comments:

```html
<!--fig:suspense:pending:N--><template id="b-N"></template>
...fallback...
<!--/fig:suspense-->
```

The start comment carries the boundary state (`pending:N`, then rewritten to
`completed` or `client` in place); the `<template>` is the boundary
placeholder that ops resolve by id (and the carrier for `data-dgst`/
`data-msg` on client-rendered boundaries). Completed-inline boundaries (those
that settle before their parent flushes — every boundary, in prerender) skip
the machinery: `<!--fig:suspense:completed-->content<!--/fig:suspense-->`.

## Segments And Ops

Content that settles after its slot flushed streams later as hidden staging
segments (`<div hidden id="s-N">`) followed by inline script ops against the
document's runtime object (written lazily, once, nonce-compatible, named per
`identifierPrefix`):

- `c(boundaryId, segmentId)` — complete a boundary: move the staged segment's
  children into the slot, delete the fallback range (nested fallback ranges
  included), rewrite the start marker to `completed`, and invoke the
  boundary's hydration retry hook (`__figRetry`) if the client already
  attached one.
- `s(placeholderId, segmentId)` — fill a partial segment (a placeholder
  inside still-streaming content).
- `x(boundaryId, digest, message)` — mark a boundary client-rendered:
  rewrite the marker to `client`, stash digest/message on the placeholder,
  ping the retry hook. The client re-renders that boundary locally.
- `r(ids, fn)` — reveal gating: wait for blocking stylesheets to load before
  running a completion, so revealed content never flashes unstyled.
- View-transition annotations (`data-fig-vt-name` and
  `data-fig-vt-class`) on staged/fallback host surfaces make `s`, `c`, and
  `ac` run their DOM moves inside `document.startViewTransition` when the
  browser supports it. Without annotations or browser support, the ops take
  the same non-animated path. Annotated reveals share the per-document
  `__figViewTransition` mutex with client commits: a reveal chains on a
  running transition's `finished` instead of skipping it, and registers its
  own transition while animating (see view-transitions.md).
- `ac`/`ax` — the Activity-hidden variants: resolve the boundary inside an
  inert `<template data-fig-activity>` content fragment (unreachable by
  id-based lookup), falling back to the light DOM if the activity already
  revealed. See activity.md.

## Client Side

Hydration parses the markers into `DehydratedSuspenseBoundary` host objects
(marker parsing lives in fig-dom, behind the reconciler's hydration host
hooks). Boundaries hydrate selectively and retries ride the `__figRetry`
hook — see hydration.md. Server errors recover only through the
client-render markers; there is no other server error channel in the
document.
