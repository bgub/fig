---
packages:
  "@bgub/fig":
    type: patch
  "@bgub/fig-server":
    type: patch
---

## Stream shell dependencies after the shell

The shell's reads now get the same treatment as a streamed Suspense
boundary's. Their opted-in `transfer` dependencies, such as a TanStack DB
collection behind a live query, follow the shell in a `d` operation instead
of riding in `takeData()`'s snapshot. The renderer writes their markers
ahead of the shell, first in `<head>` for a document, so the browser holds
those loads until the forms arrive or the document finishes loading. A page
that awaits a query in its route loader, with no Suspense boundary, now
hydrates from the query's rows before the collection's rows download.

`takeData()` no longer returns those dependency keys; `hydrateRoot` applies
them from the stream. `streamData: false` and prerendering are unchanged.
