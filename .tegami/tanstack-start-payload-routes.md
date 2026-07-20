---
packages:
  npm:@bgub/fig: minor
  npm:@bgub/fig-dom: minor
  npm:@bgub/fig-server: patch
  npm:@bgub/fig-tanstack-router: patch
  npm:@bgub/fig-tanstack-start: minor
---

## Add Payload routes to the TanStack Start adapter

`@bgub/fig-tanstack-start/payload` now exposes `payloadResource`, which turns a
raw Payload response into a Fig-owned route data resource. The initial SSR
response is embedded into the document and adopted without refetching; client
navigation and refresh use the same resource request path. Payload data rows
hydrate the shared store, asset resources are retained on their owning server
segments or inserted through the browser registry, and client references retain
their resolver-defined identity. `decodePayloadStream` and `payloadDataLoader`
now expose `retainAssets` for server document renderers that need this delivery
path.

`@bgub/fig-tanstack-start/server` now exposes `renderPayloadResponse` for
serving a component tree from a TanStack server function. Shell HTML streams
while outlined Suspense holes settle, and the completed initial responses are
embedded before TanStack starts full-document hydration. The Vite adapter also
publishes assets imported only by server modules into the client build output.
Fig Router links also consume TanStack's `viewTransition` navigation option
without forwarding it as an invalid attribute to the rendered anchor, and
derive active state from the resolved route instead of an in-flight location.
