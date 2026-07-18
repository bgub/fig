# Renderer Authoring

Status: stable

The `@bgub/fig-reconciler` surface for building hosts, and the scheduler behind it.

## HostConfig

A deliberate cleanup of react-reconciler's config, not a clone. The required core is six methods (`createInstance`, `createTextInstance`, `insertBefore`, `removeChild`, `commitUpdate`, `commitTextUpdate`); everything else is an optional capability group enforced at runtime with clear errors when the feature is first used (hydration, Activity visibility, hoisted assets). Portal children use the core mutation methods against the explicit target; the optional portal hooks are lifecycle notifications for renderers that need to prepare or release portal containers. There are no mode flags (`supportsMutation`/`supportsPersistence`), no host-context push/pop — `createInstance(type, props, parent)` and the optional `resolveHoistedInstance(type, props, parent)` receive the parent directly (how fig-dom resolves SVG/MathML namespaces) — and no `prepareForCommit`/`getPublicInstance`/microtask hooks.

`resolveHoistedInstance` is the hoisted-asset classification seam and factory in one operation. Returning `null` leaves the fiber on the ordinary hydrate/create path; returning an instance fixes that fiber's placement as hoisted for its lifetime, bypasses the hydration cursor, and activates the commit/remove/update hoisted lifecycle. The reconciler stores the resolved placement as static fiber state rather than reinterpreting host props during later traversals.

Hydration is split into capability groups:

- General host adoption requires `getFirstHydratableChild`, `getNextHydratableSibling`, `canHydrateInstance`, `canHydrateTextInstance`, and `clearContainer`; `commitHydratedInstance` is optional within that group.
- Suspense hydration is seven required methods around the host-owned `DehydratedSuspenseBoundary`: boundary parsing, enclosing-boundary lookup, containment fallback, retry registration, hydrated commit, root-hydration completion, and dehydrated-boundary removal. A host may also classify boundary mismatches that cannot be replaced locally with `shouldRecoverSuspenseMismatchAtRoot`; fig-dom uses this for a boundary that encloses a `Document`'s document element.
- Activity hydration/visibility is seven methods: boundary parsing and first- child lookup, hydrated commit, and instance/text hide/unhide hooks.

Each `HostConfig` member remains optional so a renderer can omit a capability; the exported `HostHydrationConfig`, `HostSuspenseHydrationConfig`, and `HostActivityConfig` types express the complete groups for renderers that implement them. Marker parsing stays in the renderer package where the markup knowledge lives.

## Root API

`createRenderer(hostConfig)` returns `{ createRoot, hydrateRoot, hydrateTarget, flushSync, batchedUpdates, scheduleRefresh }`. `FigRoot` is `{ data, render, unmount }`. No fiber type or lane constant crosses the boundary: priority crosses as `EventPriority` strings, and `hydrateTarget` takes one. `batchedUpdates` exists as the event-dispatch seam for renderer packages (fig-dom wires it into delegated dispatch) and is not an app-facing API — batching is automatic. Duplicate roots on one container throw; `unmount` tears down synchronously (so per-fiber data cleanup runs against a live store) and frees the container for a fresh root.

`FigRootOptions`: `onUncaughtError`, `onRecoverableError`, `identifierPrefix`, `initialData`, `dataPartition`, plus dev `devtools`.

## The Scheduler

An internal module (not a published package): a macrotask-hopping work loop with five priority tiers mapped from lanes plus starvation timeouts (expiration at the lane level complements yield-budget slicing at the task level). Host-callback preference matches React's rationale: `setImmediate` first (never refs an idle Node event loop), `MessageChannel` in browsers (created lazily — importing a renderer allocates nothing), `setTimeout` last (nested-timeout clamping). Commit calls `requestPaint()` so the loop yields to the host after mutations land. Continuation callbacks (`return () => ...`) resume sliced work.

## Subpaths

`@bgub/fig-reconciler/devtools` (commit snapshots for fig-devtools) and `@bgub/fig-reconciler/refresh` (HMR family-swap: updated component families re-render in place with hook state preserved; hook-signature changes remount via the parent) are dev-only seams with exactly the consumers they were built for.

`@bgub/fig-reconciler/test-utils` exports `act`, the testing boundary that temporarily routes scheduled callbacks into a test queue. It shares the scheduler instance used by the main renderer entry so work scheduled through either entry is flushed together; renderer construction APIs do not export it.
