# Renderer Authoring

Status: stable

The `@bgub/fig-reconciler` surface for building hosts, and the scheduler
behind it.

## HostConfig

A deliberate cleanup of react-reconciler's config, not a clone. The required
core is six methods (`createInstance`, `createTextInstance`, `insertBefore`,
`removeChild`, `commitUpdate`, `commitTextUpdate`); everything else is an
optional capability group enforced at runtime with clear errors when the
feature is first used (hydration, Activity visibility, portals, hoisted
assets). There are no mode flags (`supportsMutation`/`supportsPersistence`),
no host-context push/pop — `createInstance(type, props, parent)` receives the
parent directly (how fig-dom resolves SVG/MathML namespaces) — and no
`prepareForCommit`/`getPublicInstance`/microtask hooks. Hydration is five
optional methods around a host-owned `DehydratedSuspenseBoundary` type, which
keeps marker parsing in the renderer package where the markup knowledge
lives.

## Root API

`createRenderer(hostConfig)` returns `{ createRoot, hydrateRoot,
hydrateTarget, flushSync, batchedUpdates, scheduleRefresh }`. `FigRoot` is
`{ data, render, unmount }`. No fiber type or lane constant crosses the
boundary: priority crosses as `EventPriority` strings, and `hydrateTarget`
takes one. `batchedUpdates` exists as the event-dispatch seam for renderer
packages (fig-dom wires it into delegated dispatch) and is not an app-facing
API — batching is automatic. Duplicate roots on one container throw;
`unmount` tears down synchronously (so per-fiber data cleanup runs against a
live store) and frees the container for a fresh root.

`FigRootOptions`: `onUncaughtError`, `onRecoverableError`,
`identifierPrefix`, `initialData`, `dataContext`, `dataPartition`, plus
dev `devtools`.

## The Scheduler

An internal module (not a published package): a macrotask-hopping work loop
with five priority tiers mapped from lanes plus starvation timeouts
(expiration at the lane level complements yield-budget slicing at the task
level). Host-callback preference matches React's rationale: `setImmediate`
first (never refs an idle Node event loop), `MessageChannel` in browsers
(created lazily — importing a renderer allocates nothing), `setTimeout` last
(nested-timeout clamping). Commit calls `requestPaint()` so the loop yields
to the host after mutations land. Continuation callbacks (`return () => ...`)
resume sliced work.

## Subpaths

`@bgub/fig-reconciler/devtools` (commit snapshots for fig-devtools) and
`@bgub/fig-reconciler/refresh` (HMR family-swap: updated component families
re-render in place with hook state preserved; hook-signature changes remount
via the parent) are dev-only seams with exactly the consumers they were
built for.
