---
packages:
  npm:@bgub/fig-tanstack-start: minor
---

## Build Fig applications with TanStack Start and Vite

`@bgub/fig-tanstack-start/plugin/vite` now delegates client and SSR builds,
development and preview serving, manifests, and server-function compilation to
TanStack Start's plugin core. Default entries stream and hydrate Fig documents
without application-owned build or HTTP glue.

The package root now exposes `createServerFn`. Compiled mutations use TanStack's
RPC transport and can invalidate the live Fig data store afterward; the demo
proves the full production flow from SSR hydration through mutation and one
data-resource refresh.
