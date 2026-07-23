# Open Questions & Future Plans

## React Parity Gaps

- React forms ([https://react.dev/reference/react-dom/components/form](https://react.dev/reference/react-dom/components/form)) with function-valued form action/formAction, useFormStatus, and progressive enhancement
- Profiler, useDebugValue, performance tracks, and owner-stack capture
- DNS-prefetch asset resources
- React Canary ViewTransition transition types, lifecycle callbacks, gestures, and pseudo-element refs
  - Shouldn't be too difficult hopefully

## Hooks

- Some people use `useRef` for a mutable cell primitive. The current way to do this is `useMemo(() => ({ current }), [])`, but we could add a dedicated `useCell(initialValue)` primitive

## Hydration

- Would be cool to introduce a new primitive to fix common classes of hydration errors like local time, local, and viewport. This might remove the need for `suppressHydrationWarning` entirely. See the [hydration concept](../concepts/hydration.md) for some brainstorms

## Data Resources

- Adding first-class `reset` or `retry` functions to ErrorBoundary might be helpful. Currently you can run `invalidateDataError(error)` or `invalidateDataKey(key)` manually

## Serialized Components

- When we add optimistic-state primitives, they'll need lane awareness
- Should we add a binary payload codec?

## TanStack Adapters

- The TanStack Start plugin core and the route-file normalizer still accept only React, Solid, and Vue identifiers. Right now we map internally to Solid names but we should open an upstream PR.
- Create a TanStack Query adapter built on data resources

## Server Rendering

- Fig inlines every Suspense boundary that has completed when its parent flushes; only genuinely pending content is outlined. Unlike Fizz's `progressiveChunkSize` heuristic, this means a large completed boundary can block later shell siblings in document order. Consider revisiting in the future.
- **Early hints / preload headers** — no `onHeaders` equivalent: `headReady` resolves with the shell, too late for 103 Early Hints. Two real constraints shape any design: the Web `Response` API cannot express 103 at all (Node's `writeEarlyHints` is the only seam, so this is inherently a runtime-specific side channel), and a useful trigger point must fire before the shell yet after enough render progress to have discovered assets (first root suspension is the natural candidate — the shell being slow is exactly when 103s pay off). `Link`-header-on-200 preload emission from the asset registry is the milder, runtime-neutral half. → `docs/concepts/server-rendering.md`
- **Resume / partial prerendering** — `prerender` is all-or-nothing settled and aborting yields static fallbacks; there is no postpone/resume pair, so the slot React canary's `prerender` + `resume` fills (prerender the static shell once, resume the dynamic holes per-request) is empty. The hard part is the parked-state contract: which suspension points can park, what render-scope state serializes across the boundary (id paths, provider values, asset-registry state), and whether the byte-identical-resume invariant extends across processes. A major feature, not an increment. → `docs/concepts/server-rendering.md`

## Performance

- **Compiler-extracted templates** — a complete opt-in experiment lives on [`experimental/compile-templates`](https://github.com/bgub/fig/tree/experimental/compile-templates), including DOM/SSR/hydration/payload integration, regression coverage, and a real-browser benchmark. The direction is promising, but the compile-time optimization is deliberately outside `main` until its transformation and long-term maintenance contract feel mature enough to adopt. Revisit from the branch rather than rebuilding the spike. → Compiler-extracted templates in `docs/plans/reconciler-explorations.md`

## DevTools

- **Asset-registry inspection** — data-resource entries are already included in reconciler snapshots and rendered by the DevTools panel; equivalent asset-registry ownership, loading, gating, and conflict state is not yet exposed.
- **Payload render-tree fidelity** — `renderToPayloadStream` could accept a render-tree collector so Payload-rendered component names survive into DevTools; the payload flattening pass is the last layer that knows those names. → `docs/concepts/payload.md`
