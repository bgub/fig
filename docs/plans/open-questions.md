# Open Questions & Future Plans

## Plans

- **TanStack:** The TanStack Start plugin core and the route-file normalizer still accept only React, Solid, and Vue identifiers. Right now we map internally to Solid names but we should open an upstream PR.
- **TanStack:** Create a TanStack Query adapter built on data resources
- **Data:** Watched data resources and the `data` handle are specified in [data.md](../concepts/data.md). Still open: `setData`, optimistic overlays, and the end-to-end worker-rendering milestone. See [live-data-resources.md](./live-data-resources.md).
- **Data:** Support late transfer forms, so a dependency's rows can travel after the rows derived from it. Today an opted-in TanStack DB collection's rows precede its query's rows in the same data row and delay the reveal by their size, though the browser needs them only once the watch starts. The server side is small: `snapshotKeys` defers opted-in dependencies and a later row (after the reveal, or at the end of the stream) sends them. The browser needs a way to hand a form to an entry that already loaded without it, since the watch may start first; today `hydrateEntry` would replace the live value with the form. Options: a resource hook such as `accept(form, value)` that applies a late form to the live value (TanStack DB already keeps late chunks from overwriting rows its sync wrote), or a promised key whose load waits for the form, which delays liveness when the tail is slow. Leaning toward the hook. The same applies to the shell, where `takeData()` puts an opted-in collection ahead of the bootstrap. See [tanstack-db-adapter.md](./tanstack-db-adapter.md#gaps-and-how-they-are-closed).
- **DevTools:** Expose asset-registry ownership, loading, gating, and conflict state through DevTools.
- **DevTools:** Extend render-tree collection to `renderToPayloadStream` so Payload component names survive into DevTools.
- **DevTools:** Emit dev-only Chrome Performance extensibility entries for scheduler lanes, render attempts, commits, effects, and Suspense retries.

## API

- **Hooks:** Some people use `useRef` for a mutable cell primitive. The current way to do this is `useMemo(() => ({ current }), [])`, but we could add a dedicated `useCell(initialValue)` primitive
- **Hooks:** Does Fig need a lane-aware `useOptimistic` analog for component-local optimistic overlays, or are `useActionState` plus cache-level optimism from the planned TanStack Query adapter sufficient? For data in TanStack DB, the collection's optimistic state is enough (see [tanstack-db-adapter.md](./tanstack-db-adapter.md#writes)).
- **Error recovery:** Adding first-class `reset` or `retry` functions to ErrorBoundary might be helpful. Currently you can run `data.invalidateDataError(error)` or `data.invalidateDataKey(key)` manually
- **Hydration:** Would be cool to introduce a new primitive to fix common classes of hydration errors like local time, local, and viewport. This might remove the need for `suppressHydrationWarning` entirely. See the [hydration concept](../concepts/hydration.md) for some brainstorms
- **Payload:** Should we add some way for payload components to declare which data resources they depend on?
- **TanStack forms:** Should `@bgub/fig-tanstack-start` provide an `enhanceForm` mixin for hydrated submissions while preserving native server-function URL fallback?

## Performance

- **Payload:** Should we add a binary codec?
- **SSR streaming:** Fig inlines every Suspense boundary that has completed when its parent flushes; only genuinely pending content is outlined. Unlike Fizz's `progressiveChunkSize` heuristic, this means a large completed boundary can block later shell siblings in document order. Consider revisiting in the future.
- Partial pre-rendering?? (we don't have to do bundler dynamic/static analysis like Next does)
- **Early hints:** Should Fig also report preload discoveries before the shell so runtime adapters can send `103 Early Hints`? The Web `Response` API cannot represent interim responses, so emission would remain adapter-specific.
