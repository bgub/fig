---
packages:
  "@bgub/fig":
    type: minor
  "@bgub/fig-reconciler":
    type: patch
  "@bgub/fig-server":
    type: patch
---

## Add transfer rules for data resources

Add the `transfer` data-resource option. `transfer: false` keeps a resource's entries (a database client, a connection) out of `getData()`, `takeData()`, `snapshot()`, streamed Suspense data, and Payload data rows. `transfer(value)` sends a serializable form instead, taken when the snapshot or row is written (or just before disposal retires the value); the receiving store hands that form to the resource's next load as `context.transferred` rather than rendering it. In dev, a render read whose load returns a promise for a transferred value throws, since that read would suspend hydration for state that already arrived. Streamed Suspense data and Payload data rows now also carry the entries a read's load ensured through `data` that declare a `transfer` function, ahead of the read, so a derived value arrives with its sources.

Add `requireCapability(reason?)` and `MissingCapabilityError`. A load that needs a capability (such as IndexedDB) calls it where that capability is missing; during server rendering a read of that entry leaves the nearest Suspense fallback for the browser (via `readBrowser`) without reporting `onError`, and `data.ensureData` rejects with the error. A requirement thrown before any asynchronous work settles synchronously so the shell decides it.
