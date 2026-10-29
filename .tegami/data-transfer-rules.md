---
packages:
  "@bgub/fig":
    type: minor
  "@bgub/fig-reconciler":
    type: patch
  "@bgub/fig-server":
    type: patch
---

Add data-resource transfer rules. `dehydrate: false` keeps a resource's entries out of `getData()`, `snapshot()`, and Payload data rows; `dehydrate(value)` sends a serializable form instead, captured when the snapshot is taken or, if the store is disposed first, just before disposal retires the live value. `rehydrate(dehydrated, { signal, data })` revives a hydrated entry into a live value the first time a reader names the resource, with a signal that retires the revived value with its entry.

Add `requireBrowser(reason?)` and `BrowserRequiredError`. A load that needs browser-only capabilities calls it where they are missing; during server rendering a read of that entry leaves the nearest Suspense fallback for the browser (via `readBrowser`) without reporting `onError`, and `data.ensureData` rejects with the error. A requirement thrown before any asynchronous work settles synchronously so the shell decides it.
