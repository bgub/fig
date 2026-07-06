# Open Questions & Future Plans

Status: living summary

Every open design question and planned piece of work, in one place. Each item
links its source (a concept file's `exploring` section or a plan in
`plans/`); when an item resolves, it graduates into the owning concept file
and leaves this list.

## JSX

- **Stage-2 attribute typing** — replace `HostProps`' open attribute index
  with a closed vocabulary from an externally-maintained attribute package
  (decided: no hand-curation) for typo protection; SVG/MathML-only tags
  likely keep an open index. The chosen package must use native attribute
  names, not React's. → `concepts/jsx.md`

## Hydration

- **Hydration-stable environment** — the one intentional-divergence class
  (time, locale, color scheme, viewport) gets a serialized environment
  snapshot the client's hydration render reads, not a
  `suppressHydrationWarning` clone. Open: ownership (fig-start vs fig-dom vs
  core), app-wide vs nested scopes, how the client learns hydration finished,
  bootstrap-path vs renderer-slot serialization, a pre-hydration `<html>`
  helper for color-scheme flash, a `hydrateRoot` snapshot option, and the
  missing-snapshot failure mode. → `concepts/hydration.md`

## Data Resources

From `plans/data-resources.md` (open questions that survived shipping):

- Should the stable data API ever move from `@bgub/fig-data` into
  `@bgub/fig`, and should the renderer bridge become versioned
  `RenderDispatcher` methods instead of the `@bgub/fig/internal` slot?
- A first-class `ErrorBoundary` retry/reset API for failed keys (today:
  function fallback + invalidate + remount-by-key composes it manually).
- Payload refresh ↔ data keys: payload streams data rows in the same response;
  still open is a targeted protocol that maps invalidated keys to refreshed
  payload boundaries without overfitting to one framework.
- **Payload codec productization** — value fidelity for `Date`/`Map`/
  `undefined` and related non-JSON values now lives in the payload value
  codec. Still open: whether Fig Start exposes codec selection as a first-class
  option, when to ship a binary codec, and whether binary codec ids need
  explicit versioning beyond the opaque implementation id.

## Asset Resources

From `plans/asset-resources.md` (phase 5 unimplemented):

- **Bundler manifest integration** — the minimal manifest shape Fig requires
  for client-reference assets (also README's standing "future goal").
- Open: should all client-reference stylesheets block reveal by default; how
  stylesheet precedence interacts with segment streaming order; how the
  whether `title`/`meta` ever travel the payload asset path.

## fig-start

- **M2 of the server plan** (`plans/fig-start-servers.md`): the production
  server milestone — Effect-internal lifecycle, static asset policy,
  manifest caching, operational logging — behind the same Effect-free public
  boundary as the dev server.
- **Server action transport** — deliberately left out of `useActionState`
  core; the framework layer owns the wire (`concepts/hooks.md`).

## Performance

- **Reconciler placement, remaining gaps** — the placement passes closed the
  reverse-keyed reorder gap (append/prepend now beat React on the tracked
  benchmark); initial mount and same-order updates still trail. →
  `plans/reconciler-placement-performance.md`

## DevTools

- Data-store and asset-registry inspection panels (entry snapshots exist via
  `onEntryChange`/`inspectDataEntries`; no UI consumes them yet) — sketched
  in both resource proposals' DevTools sections.
