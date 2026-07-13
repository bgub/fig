---
packages:
  npm:@bgub/fig: patch
  npm:@bgub/fig-dom: minor
---

## fig-start moves to the serialized-components resource model

Server routes are now ordinary data resources: fig-start serves plain
payload streams per URL (no `PayloadBoundary`, no `x-fig-payload-boundary`
header), and the client consumes them through a `[routeId, url]`-keyed
`dataResource` with `payloadDataLoader` — refresh is `refreshData`, child
navigation is a new URL key, and back/forward navigations reuse cached
entries. Navigation commits wait for the incoming payload, its island
modules, and its stylesheet gates.

The initial document binds without a fetch: the segment's loader serves the
inline payload frame stream as a synthetic `Response` (frames now carry an
`end` marker), so streamed holes keep filling after the shell flush through
the same generation-guarded decode as any navigation. The document's
server-side render also uses `decodePayloadStream` now.

Supporting API additions: `payloadDataLoader` accepts a `prepareAssets`
override (defaults to `insertAssetResources`), and `decodePayloadStream`
accepts an `onClientReference` observer for reference metadata.
