# Open Questions & Future Plans

## React Parity Gaps

- React forms ([https://react.dev/reference/react-dom/components/form](https://react.dev/reference/react-dom/components/form)) with function-valued form action/formAction, useFormStatus, and progressive enhancement
- Server Functions
  - This is both one of the most valuable things to add, and one of the things I want to be most cautious about adding
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

## Server Rendering

- **Early hints / preload headers** — no `onHeaders` equivalent: `headReady` resolves with the shell, too late for 103 Early Hints. Two real constraints shape any design: the Web `Response` API cannot express 103 at all (Node's `writeEarlyHints` is the only seam, so this is inherently a runtime-specific side channel), and a useful trigger point must fire before the shell yet after enough render progress to have discovered assets (first root suspension is the natural candidate — the shell being slow is exactly when 103s pay off). `Link`-header-on-200 preload emission from the asset registry is the milder, runtime-neutral half. → `docs/concepts/server-rendering.md`
- **Size-based outlining** — no `progressiveChunkSize`: the outline-vs-inline choice is purely flush-time completion state, and consumer backpressure already shifts it naturally (a slow consumer coalesces less-urgent work; see Flow Control). A byte threshold that outlines huge completed-early boundaries out of the shell flush would change the completed-inline wire shape and needs evidence that big inlined boundaries actually hurt first paint before it earns the churn. → `docs/concepts/server-rendering.md`
- **Resume / partial prerendering** — `prerender` is all-or-nothing settled and aborting yields static fallbacks; there is no postpone/resume pair, so the slot React canary's `prerender` + `resume` fills (prerender the static shell once, resume the dynamic holes per-request) is empty. The hard part is the parked-state contract: which suspension points can park, what render-scope state serializes across the boundary (id paths, provider values, asset-registry state), and whether the byte-identical-resume invariant extends across processes. A major feature, not an increment. → `docs/concepts/server-rendering.md`

## TanStack Adapters

- **Native TanStack Start framework target** — generated and lazy file routes are shipped, but plugin core and the route-file normalizer still accept only React, Solid, and Vue identifiers. Upstream needs an extensible framework descriptor (package ids, route templates, compiler imports, refresh behavior) before Fig can remove its private Solid package-id mappings. The route objects, runtime, store, and hydration contracts do not depend on that change.
- **TanStack Query adapter** — a Query-flavored API over data resources would layer freshness policy (stale timers, refetch-on-focus) above the two core verbs. Build when demand appears.
- **Server action transport and temporary references** — server action transport is deliberately left out of `useActionState` core, and both server actions and temporary references are absent from the Payload row model; the framework layer owns the wire (`docs/concepts/hooks.md`, `docs/concepts/payload.md`).
- **Nested-segment routing (Next-style parallel segments)** — a segment router mostly falls out of shipped primitives: segments as keyed Payload resources, composition via client-reference outlets, manifest-driven eager loads on navigation via `preloadData`, and transitions for atomic commits. The open design piece is cold-load composition — one request delivering several segment entries. Address it when a segment router is planned.

## View Transitions

- **Parked-commit latency safeguards** — rapid interactions already render while the current transition runs and coalesce to the latest state for the next animation window. The browser cannot retarget a snapshot animation mid-flight, so truly high-frequency motion (sortable lists, steppers) still belongs on live-element FLIP with springs/CSS transitions — worth a docs pointer. If parked-commit latency proves to matter in practice, three unimplemented API-free designs were sketched (2026-07), in preference order: fast-forwarding the running transition's pseudo-element animations via `playbackRate` when a commit parks (no teleport, safe for background commits); a park-timeout backstop that `skipTransition()`s a non-settling animation (also closes the `animation-iteration-count: infinite` footgun, which today parks eligible commits until the animation ends — sync/default commits are unaffected); and stale-surface auto-interrupt (skip only when the incoming commit's surface names overlap the running transition's — the animation is heading somewhere the commit invalidates). An opt-in `transition(cb, { interrupt: true })` stays in the drawer unless real usage demands per-call control. → `docs/concepts/view-transitions.md`

## Performance

- **Reconciler performance tracking** — the current 1,000-row in-memory-host matrix has Fig ahead of React on initial mount, same-order updates, append/prepend, and reverse-keyed reorder on the development machine. These numbers are machine- and revision-sensitive, so keep the paired 15-sample measurement protocol in `docs/plans/reconciler-explorations.md` rather than treating a particular lead or gap as a durable contract.
- **Compiler-extracted templates** — a complete opt-in experiment lives on [`experimental/compile-templates`](https://github.com/bgub/fig/tree/experimental/compile-templates), including DOM/SSR/hydration/payload integration, regression coverage, and a real-browser benchmark. The direction is promising, but the compile-time optimization is deliberately outside `main` until its transformation and long-term maintenance contract feel mature enough to adopt. Revisit from the branch rather than rebuilding the spike. → Compiler-extracted templates in `docs/plans/reconciler-explorations.md`

## DevTools

- **Asset-registry inspection** — data-resource entries are already included in reconciler snapshots and rendered by the DevTools panel; equivalent asset-registry ownership, loading, gating, and conflict state is not yet exposed.
- **Payload render-tree fidelity** — `renderToPayloadStream` could accept a render-tree collector so Payload-rendered component names survive into DevTools; the payload flattening pass is the last layer that knows those names. → `docs/concepts/payload.md`
