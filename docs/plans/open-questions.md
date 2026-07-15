# Open Questions & Future Plans

Status: living plan index

Every open design question and planned piece of work, in one place. Each item links its source (a concept file's `exploring` section or a plan in `docs/plans/`); when an item resolves, it graduates into the owning concept file and leaves this list.

## React Parity Gaps

Most valuable gaps:

- Function-valued form action/formAction, useFormStatus, progressive enhancement, and Server Functions. React forms (https://react.dev/reference/react-dom/components/form)
- Profiler, useDebugValue, performance tracks, and owner-stack capture.
- DNS-prefetch asset resources.
- React Canary ViewTransition transition types, lifecycle callbacks, gestures, and pseudo-element refs.

## Hooks

- **Mutable cell primitive (`useCell`?)** — `useMemo(() => ({ current }), [])` currently provides stable mutable storage, but memoization communicates caching rather than instance-local mutable identity. Open: whether Fig should add a dedicated `useCell(initialValue)` primitive, whether its shape should be `{ current: T }`, and whether the name should emphasize stable identity, mutability, or its non-rendering semantics.

## Hydration

- **Hydration-stable environment** — the one intentional-divergence class (time, locale, viewport) gets a serialized environment snapshot the client's hydration render reads, not a broad mismatch opt-out. Open: ownership (fig-start vs fig-dom vs core), app-wide vs nested scopes, how the client learns hydration finished, bootstrap-path vs renderer-slot serialization, a `hydrateRoot` snapshot option, and the missing-snapshot failure mode. Request-known shell state like cookie-backed color scheme belongs in the Fig Start document shell. `suppressHydrationWarning` now exists only as React-compatible one-level host escape hatch. → `docs/concepts/hydration.md`

## Data Resources

- **ErrorBoundary reset ergonomics** — data-key attribution and invalidation now exist (`invalidateDataError(error)`, `invalidateDataKey(key)`). Still open: whether `ErrorBoundary` should expose a first-class reset/retry affordance instead of making userland remount the boundary by key.

## Serialized Components

Payload trees are delivered as ordinary data resources, and the targeted-refresh protocol was removed after its parity gate passed. Remaining follow-ups:

- **Wire shape for the resource value** — lean: core defines stream-of-rows in, value out; the framework owns HTTP and any envelope.
- **Promise-valued children** — the intended authoring story (`{loadComments(slug).then(...)}` as a Suspense child) needs thenable children accepted by the payload serializer and the client reconciler; today only suspending server components and promise-valued props outline holes.
- **Optimistic-state primitive** — needs lane awareness so it cannot live in a framework. Capture in its own plan.
- **Payload codec productization** — whether Fig Start exposes codec selection as a first-class option, when to ship a binary codec, and whether binary codec ids need explicit versioning beyond the opaque implementation id.

## Asset Resources

- **Streamed stylesheet precedence** — how precedence should interact with independently streamed segments when bundler-discovered stylesheets share or conflict in ordering. The current manifest integration preserves discovery order but does not define a stronger cross-segment policy. → `docs/concepts/assets.md`
- **Late head assets are diagnosed, not delivered** — a `title`/`meta` discovered under a pending Suspense boundary after the streaming head seals only triggers `onAssetError`; React's Float runtime inserts into `<head>` client-side at any time. Sketch: a small head-update op in the existing inline runtime (e.g. `t(value)` swapping `document.title`) emitted when a head-destination asset registers after sealing. Must stay visible to the client's key-based asset dedupe (no double titles on later insertions) and have payload-wire parity. Prerender avoids the class by sealing late. → `docs/concepts/assets.md`, `docs/concepts/server-rendering.md`
- **Declassifying updates to hoisted host elements** — hoisted placement is resolved once per fiber (`resolveHoistedInstance`), but `updateHoistedResource` re-derives the asset from props on every update. An update whose props stop classifying (a hoisted `<script async>` re-rendered with `async={false}`, a `<link rel="stylesheet">` changed to `rel="alternate"`) derives no key and falls into in-place `updateElement`, mutating a head element that other owners share by key — the same-identity fast path quietly violates the contract the rekeying path respects (release the old share, adopt the new). The fiber also keeps its hoisted lifecycle for life, so it never becomes an ordinary in-tree element. Suggested fix: a dev-only diagnostic that throws when an update declassifies a hoisted element, making the pattern loudly unsupported instead of silently mutating shared state. → `docs/concepts/assets.md`

## Server Rendering

- **Early hints / preload headers** — no `onHeaders` equivalent: `headReady` resolves with the shell, too late for 103 Early Hints. Two real constraints shape any design: the Web `Response` API cannot express 103 at all (Node's `writeEarlyHints` is the only seam, so this is inherently a runtime-specific side channel), and a useful trigger point must fire before the shell yet after enough render progress to have discovered assets (first root suspension is the natural candidate — the shell being slow is exactly when 103s pay off). `Link`-header-on-200 preload emission from the asset registry is the milder, runtime-neutral half. → `docs/concepts/server-rendering.md`
- **Size-based outlining** — no `progressiveChunkSize`: the outline-vs-inline choice is purely flush-time completion state, and consumer backpressure already shifts it naturally (a slow consumer coalesces less-urgent work; see Flow Control). A byte threshold that outlines huge completed-early boundaries out of the shell flush would change the completed-inline wire shape and needs evidence that big inlined boundaries actually hurt first paint before it earns the churn. → `docs/concepts/server-rendering.md`
- **Resume / partial prerendering** — `prerender` is all-or-nothing settled and aborting yields static fallbacks; there is no postpone/resume pair, so the slot React canary's `prerender` + `resume` fills (prerender the static shell once, resume the dynamic holes per-request) is empty. The hard part is the parked-state contract: which suspension points can park, what render-scope state serializes across the boundary (id paths, provider values, asset-registry state), and whether the byte-identical-resume invariant extends across processes. A major feature, not an increment. → `docs/concepts/server-rendering.md`

## fig-start

- **Server action transport and temporary references** — server action transport is deliberately left out of `useActionState` core, and both server actions and temporary references are absent from the payload row model; the framework layer owns the wire (`docs/concepts/hooks.md`, `docs/concepts/payload.md`).
- **Request state for remote data loaders** — `remoteDataResource` loaders run inside fig-start's data endpoint, which owns the request; loaders receive only `(...args, { signal })`. Open: whether fig-start provides an ambient per-request context (e.g. `AsyncLocalStorage`-backed) for those loaders, or keeps auth and services in module scope. → `docs/concepts/data.md`
- **Nested-segment routing (Next-style parallel segments)** — a segment router mostly falls out of shipped primitives: segments as keyed payload resources, composition via client-reference outlets, manifest-driven eager loads on navigation via `preloadData`, transitions for atomic commits. The open design piece is cold-load composition — one request delivering several segment entries. `data` rows deliberately use the value codec (no `element`/`client` models, no holes), so sibling segments cannot ride one stream today; candidate shapes are element-valued data rows (heavy: holes and asset gates span the whole stream), multi-root streams whose loader publishes each addressable root into its own entry, or serving initial segments over the existing document frame path and reserving per-segment requests for navigations. The former identity prerequisite is shipped: a caller-owned stateful resolver (`createPayloadClientReferenceResolver`) keeps gated and asynchronously resolved references identity-stable across decodes (`docs/concepts/payload.md`), and fig-start already passes one. Nothing shipped depends on the rest — address when a segment router is planned.

## View Transitions

- **Parked-commit latency safeguards** — rapid interactions already render while the current transition runs and coalesce to the latest state for the next animation window. The browser cannot retarget a snapshot animation mid-flight, so truly high-frequency motion (sortable lists, steppers) still belongs on live-element FLIP with springs/CSS transitions — worth a docs pointer. If parked-commit latency proves to matter in practice, three unimplemented API-free designs were sketched (2026-07), in preference order: fast-forwarding the running transition's pseudo-element animations via `playbackRate` when a commit parks (no teleport, safe for background commits); a park-timeout backstop that `skipTransition()`s a non-settling animation (also closes the `animation-iteration-count: infinite` footgun, which today parks eligible commits until the animation ends — sync/default commits are unaffected); and stale-surface auto-interrupt (skip only when the incoming commit's surface names overlap the running transition's — the animation is heading somewhere the commit invalidates). An opt-in `transition(cb, { interrupt: true })` stays in the drawer unless real usage demands per-call control. → `docs/concepts/view-transitions.md`

## Performance

- **Reconciler performance tracking** — the current 1,000-row in-memory-host matrix has Fig ahead of React on initial mount, same-order updates, append/prepend, and reverse-keyed reorder on the development machine. These numbers are machine- and revision-sensitive, so keep the paired 15-sample measurement protocol in `docs/plans/reconciler-explorations.md` rather than treating a particular lead or gap as a durable contract.
- **Compiler-extracted templates** — a complete opt-in experiment lives on [`experimental/compile-templates`](https://github.com/bgub/fig/tree/experimental/compile-templates), including DOM/SSR/hydration/payload integration, regression coverage, and a real-browser benchmark. The direction is promising, but the compile-time optimization is deliberately outside `main` until its transformation and long-term maintenance contract feel mature enough to adopt. Revisit from the branch rather than rebuilding the spike. → Compiler-extracted templates in `docs/plans/reconciler-explorations.md`

## DevTools

- **Asset-registry inspection** — data-resource entries are already included in reconciler snapshots and rendered by the DevTools panel; equivalent asset-registry ownership, loading, gating, and conflict state is not yet exposed.
- **Payload render-tree fidelity** — `renderToPayloadStream` could accept a render-tree collector so server-component names survive into DevTools; the payload flattening pass is the last layer that knows those names. → `docs/concepts/payload.md`
