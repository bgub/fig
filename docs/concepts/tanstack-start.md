# TanStack Start Adapter

Status: implemented runtime; Vite plugin pending

`@bgub/fig-tanstack-start` adapts TanStack Start's request and hydration cores to Fig. TanStack owns request middleware, route loading, redirects, and router-match dehydration. Fig owns component rendering, data-resource identity and freshness, the data store, its document serialization, and asset resources.

## Single-Store Ownership

`createStartDataContext()` creates one root-neutral Fig store and returns the router context containing it. Server route loaders call `ensureRouteData` through that handle before rendering. `renderRouterToStream` passes the same store to `renderToDocumentStream`, which adopts it and attaches the server renderer lifecycle. On the client, the adapter decodes the Fig-owned document snapshot into a fresh Fig store before `hydrateRoot` adopts it and attaches reactive scheduling. TanStack never stores the values in `loaderData` and never owns or copies the cache.

The application renders `StartData` near the end of its document body, after route content and before `Scripts`. It emits a non-executable JSON script containing Fig's encoded data entries. Encoding uses Fig's payload value codec, including graph identity and supported non-JSON values; `<` and JavaScript line-separator characters are escaped for safe inline HTML. On the client, `createStartDataContext` eagerly decodes that earlier script while constructing the router, before TanStack hydration can start client-only route loaders. The client entry repeats the step idempotently as a fallback before the first Fig render in case router construction preceded the script.

The contract is covered end to end: a Router loader populates the server store, that exact store renders the document, a fresh client document supplies the serialized snapshot, initial hydration performs no resource load, and invalidating the hydrated entry performs exactly one new load.

## Remaining Plugin Boundary

The runtime adapter is independent of a bundler. TanStack Start's current plugin-core framework type is closed over React, Solid, and Vue, so a first-class Fig Vite plugin needs a small upstream extensibility change or a deliberately maintained plugin adapter. The runtime contract is kept separate so that bundler decision cannot change store, rendering, or hydration semantics.
