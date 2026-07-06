# Open Questions & Future Plans

Status: living summary

Every open design question and planned piece of work, in one place. Each item
links its source (a concept file's `exploring` section or a plan in
`plans/`); when an item resolves, it graduates into the owning concept file
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
  `concepts/hydration.md`

## Data Resources

From `plans/data-resources.md` (open questions that survived shipping):

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

From `plans/asset-resources.md` (phase 5 unimplemented):

- **Bundler manifest integration** — the minimal manifest shape Fig requires
  for client-reference assets (also README's standing "future goal").
- Open: how stylesheet precedence interacts with independently streamed
  segments once bundler-discovered stylesheets are common.

## fig-start

- **M2 of the server plan** (`plans/fig-start-servers.md`): the production
  server milestone — Effect-internal lifecycle, static asset policy,
  manifest caching, operational logging — behind the same Effect-free public
  boundary as the dev server.
- **Server action transport** — deliberately left out of `useActionState`
  core; the framework layer owns the wire (`concepts/hooks.md`).
- **Request state for remote data loaders** — `remoteDataResource` loaders
  run inside fig-start's data endpoint, which owns the request; loaders
  receive only `(...args, { signal })`. Open: whether fig-start provides an
  ambient per-request context (e.g. `AsyncLocalStorage`-backed) for those
  loaders, or keeps auth and services in module scope. → `concepts/data.md`

## Performance

- **Reconciler placement, remaining gaps** — the placement passes closed the
  reverse-keyed reorder gap (append/prepend now beat React on the tracked
  benchmark); initial mount and same-order updates still trail. →
  `plans/reconciler-placement-performance.md`

## DevTools

- Data-store and asset-registry inspection panels (entry snapshots exist via
  `onEntryChange`/`inspectDataEntries`; no UI consumes them yet) — sketched
  in both resource proposals' DevTools sections.
