# Open Questions & Future Plans

## Plans

- **TanStack:** The TanStack Start plugin core and the route-file normalizer still accept only React, Solid, and Vue identifiers. Right now we map internally to Solid names but we should open an upstream PR.
- **TanStack:** Create a TanStack Query adapter built on data resources
- **DevTools:** Expose asset-registry ownership, loading, gating, and conflict state through DevTools.
- **DevTools:** Extend render-tree collection to `renderToPayloadStream` so Payload component names survive into DevTools.
- **DevTools:** Emit dev-only Chrome Performance extensibility entries for scheduler lanes, render attempts, commits, effects, and Suspense retries.

## React Parity Gaps

- React Canary ViewTransition transition types, lifecycle callbacks, gestures, and pseudo-element refs
  - Shouldn't be too difficult hopefully

## API

- **Hooks:** Some people use `useRef` for a mutable cell primitive. The current way to do this is `useMemo(() => ({ current }), [])`, but we could add a dedicated `useCell(initialValue)` primitive
- **Hooks:** Does Fig need a lane-aware `useOptimistic` analog for component-local optimistic overlays, or are `useActionState` plus cache-level optimism from the planned TanStack Query adapter sufficient?
- **Error recovery:** Adding first-class `reset` or `retry` functions to ErrorBoundary might be helpful. Currently you can run `invalidateDataError(error)` or `invalidateDataKey(key)` manually
- **Hydration:** Would be cool to introduce a new primitive to fix common classes of hydration errors like local time, local, and viewport. This might remove the need for `suppressHydrationWarning` entirely. See the [hydration concept](../concepts/hydration.md) for some brainstorms
- **Payload:** Should we add some way for payload components to declare which data resources they depend on?
- **TanStack forms:** Should `@bgub/fig-tanstack-start` provide an `enhanceForm` mixin for hydrated submissions while preserving native server-function URL fallback?

## Performance

- **Payload:** Should we add a binary codec?
- **SSR streaming:** Fig inlines every Suspense boundary that has completed when its parent flushes; only genuinely pending content is outlined. Unlike Fizz's `progressiveChunkSize` heuristic, this means a large completed boundary can block later shell siblings in document order. Consider revisiting in the future.
- Partial pre-rendering?? (we don't have to do bundler dynamic/static analysis like Next does)
- **Early hints:** Should Fig also report preload discoveries before the shell so runtime adapters can send `103 Early Hints`? The Web `Response` API cannot represent interim responses, so emission would remain adapter-specific.
- **Preload headers:** Let server adapters obtain a deduplicated `Link` header for render-discovered asset preloads before creating the response.
