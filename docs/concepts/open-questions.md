# Open Questions & Future Plans

Status: living summary

Every open design question and planned piece of work, in one place. Each item
links its source (a concept file's `exploring` section or a plan in
`docs/plans/`); when an item resolves, it graduates into the owning concept file
and leaves this list.

## Hydration

- **Hydration-stable environment** — the one intentional-divergence class
  (time, locale, viewport) gets a serialized environment snapshot the
  client's hydration render reads, not a broad mismatch opt-out. Open:
  ownership (fig-start vs fig-dom vs core), app-wide vs nested scopes, how the
  client learns hydration finished, bootstrap-path vs renderer-slot
  serialization, a `hydrateRoot` snapshot option, and the missing-snapshot
  failure mode. Request-known shell state like cookie-backed color scheme
  belongs in the Fig Start document shell. `suppressHydrationWarning` now
  exists only as React-compatible one-level host escape hatch. →
  `docs/concepts/hydration.md`

## Data Resources

- **ErrorBoundary reset ergonomics** — data-key attribution and invalidation
  now exist (`invalidateDataError(error)`, `invalidateDataKey(key)`). Still
  open: whether `ErrorBoundary` should expose a first-class reset/retry
  affordance instead of making userland remount the boundary by key.
- **Payload codec productization** — value fidelity for `Date`/`Map`/
  `undefined` and related non-JSON values now lives in the payload value
  codec. Still open: whether Fig Start exposes codec selection as a first-class
  option, when to ship a binary codec, and whether binary codec ids need
  explicit versioning beyond the opaque implementation id.

## Asset Resources

- **Streamed stylesheet precedence** — how precedence should interact with
  independently streamed segments when bundler-discovered stylesheets share
  or conflict in ordering. The current manifest integration preserves
  discovery order but does not define a stronger cross-segment policy. →
  `docs/concepts/assets.md`

## fig-start

- **Server action transport** — deliberately left out of `useActionState`
  core; the framework layer owns the wire (`docs/concepts/hooks.md`).
- **Request state for remote data loaders** — `remoteDataResource` loaders
  run inside fig-start's data endpoint, which owns the request; loaders
  receive only `(...args, { signal })`. Open: whether fig-start provides an
  ambient per-request context (e.g. `AsyncLocalStorage`-backed) for those
  loaders, or keeps auth and services in module scope. → `docs/concepts/data.md`

## View Transitions

- **Parked-commit latency safeguards** — rapid interactions already render
  while the current transition runs and coalesce to the latest state for the
  next animation window. The browser cannot retarget a snapshot animation
  mid-flight, so truly high-frequency motion (sortable lists, steppers) still
  belongs on live-element FLIP with springs/CSS transitions — worth a docs
  pointer. If parked-commit latency proves to matter in practice, three
  unimplemented API-free designs were sketched (2026-07), in preference order:
  fast-forwarding the running transition's pseudo-element animations via
  `playbackRate` when a commit parks (no teleport, safe for background
  commits); a park-timeout backstop that `skipTransition()`s a non-settling
  animation (also closes the `animation-iteration-count: infinite` footgun,
  which today parks eligible commits until the animation ends — sync/default
  commits are unaffected); and stale-surface auto-interrupt (skip only when
  the incoming commit's surface names overlap the running transition's —
  the animation is heading somewhere the commit invalidates). An opt-in
  `transition(cb, { interrupt: true })` stays in the drawer unless real
  usage demands per-call control. → `docs/concepts/view-transitions.md`

## Performance

- **Reconciler placement, remaining gaps** — the placement passes closed the
  reverse-keyed reorder gap (append/prepend now beat React on the tracked
  benchmark); initial mount and same-order updates still trail.
- **Compiler-extracted templates** — a complete opt-in experiment lives on
  [`experimental/compile-templates`](https://github.com/bgub/fig/tree/experimental/compile-templates),
  including DOM/SSR/hydration/payload integration, regression coverage, and a
  real-browser benchmark. The direction is promising, but the compile-time
  optimization is deliberately outside `main` until its transformation and
  long-term maintenance contract feel mature enough to adopt. Revisit from
  the branch rather than rebuilding the spike. → Compiler-extracted templates in
  `docs/plans/reconciler-explorations.md`

## DevTools

- **Asset-registry inspection** — data-resource entries are already included
  in reconciler snapshots and rendered by the DevTools panel; equivalent
  asset-registry ownership, loading, gating, and conflict state is not yet
  exposed.
- **Payload bootstrap consolidation** — inline payload frame/bootstrap
  builders still exist separately in Fig Start and `demo-payload`. A third
  consumer should move the shared mechanism to `@bgub/fig-server/payload`.
- **Payload render-tree fidelity** — `renderToPayloadStream` could accept a
  render-tree collector so server-component names survive into DevTools; the
  payload flattening pass is the last layer that knows those names.
