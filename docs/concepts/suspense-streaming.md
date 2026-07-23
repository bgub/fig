# Suspense Streaming Protocol

Status: stable

Suspense lets the server send a fallback now and the completed content later. A small marker format tells the browser where that later content belongs.

## Boundary Markers

A pending boundary looks like this:

```html
<!--fig:suspense:pending:N--><template id="b-N"></template>
...fallback...
<!--/fig:suspense-->
```

The start comment records the boundary state. The template marks the insertion point and may carry `data-dgst` and `data-msg` for a client-rendered boundary.

If the content finishes before its parent flushes, Fig writes it inline and needs no staging machinery:

```html
<!--fig:suspense:completed-->...content...<!--/fig:suspense-->
```

Prerendered boundaries always use this completed-inline form unless they fail.

## Staged Segments

Content that finishes after its slot has flushed arrives in a hidden `<div id="s-N">`. An inline operation moves the staged nodes into place. The runtime is written lazily once per document, uses the render's `identifierPrefix`, and carries the configured CSP nonce.

The operations are:

- `c(boundaryId, segmentId, metadata?)` completes a boundary. It replaces the fallback, marks the boundary completed, and applies an optional title/meta snapshot in the same operation.
- `s(placeholderId, segmentId)` fills a partial segment inside content that is still streaming.
- `x(boundaryId, digest, message)` marks a boundary for client rendering and wakes its hydration retry.
- `r(ids, fn)` waits for blocking stylesheets before revealing content.
- `ac` and `ax` are the matching completion and error operations for content inside a hidden Activity template.

If hydration already owns a boundary, `c` leaves metadata to the renderer commit and calls the attached `__figRetry` hook instead.

## View Transitions

Staged and fallback surfaces may carry `data-fig-vt-name` and `data-fig-vt-class`. When the browser supports native view transitions, the `s`, `c`, and `ac` DOM moves run inside `document.startViewTransition`.

Streaming reveals share the document's `__figViewTransition` mutex with client commits. A reveal waits for an active transition instead of skipping animation. Without annotations or browser support, the same operations take the normal non-animated path.

## Hydration

Fig DOM parses the comments into `DehydratedSuspenseBoundary` objects and exposes them through the reconciler's hydration hooks. A boundary may remain dehydrated until background work or user interaction asks for it. Retries use the boundary's `__figRetry` hook.

Server errors recover through the `x` client-render marker. There is no second hidden error channel in the document.
