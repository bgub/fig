# Renderer Authoring

Status: stable

`@bgub/fig-reconciler` lets a host connect Fig's component model to its own nodes. A renderer supplies mutation primitives and opts into larger capabilities such as hydration, Activity, and asset hoisting.

## `HostConfig`

The required core is six methods:

- `createInstance`
- `createTextInstance`
- `insertBefore`
- `removeChild`
- `commitUpdate`
- `commitTextUpdate`

Everything else is an optional capability group. Fig validates a group when the application first uses that feature and reports a clear missing-capability error.

Unlike `react-reconciler`, Fig has no mutation/persistence mode flags, host-context stack, `prepareForCommit`, `getPublicInstance`, or microtask hooks. `createInstance(type, props, parent)` receives its parent directly, which is enough for Fig DOM to choose HTML, SVG, or MathML namespaces.

Portal children use the normal mutation methods against their target. Optional portal hooks are lifecycle notifications for hosts that need to prepare and release containers.

## Hoisted Assets

`resolveHoistedInstance(type, props, parent)` classifies and creates hoisted host elements. Returning `null` keeps the ordinary in-tree path. Returning an instance makes that placement permanent for the fiber's lifetime and bypasses the hydration cursor.

Later updates may replace the shared instance through `updateHoistedInstance`, but they cannot turn the fiber back into an ordinary element. Fig DOM reports that invalid update in development and ignores it in production.

Each hoisted host and `Assets` fiber receives an owner token that stays stable across updates and moves. Acquire, update, release, and `commitAssetResources(previous, next, owner)` use it to support metadata claims as well as simple reference counts.

The hoisted update hook owns the complete update, including text. If it returns a different shared instance, the reconciler adopts that instance on both fiber generations and does not apply a second generic text update.

## Hydration Capabilities

General host hydration requires methods for finding hydratable children and siblings, adopting element and text instances, and clearing the container. `commitHydratedInstance` is optional.

Suspense hydration adds a complete group for:

- parsing dehydrated boundaries;
- finding enclosing boundaries;
- checking containment;
- installing retries;
- committing hydration;
- finishing root hydration; and
- removing dehydrated boundaries.

A host may also say that a mismatch must recover at the root. Fig DOM uses this when a boundary contains the document element.

Activity adds boundary parsing, first-child lookup, hydrated commit, and instance/text hide and unhide hooks. Marker parsing stays in the renderer package that owns the markup.

The exported `HostHydrationConfig`, `HostSuspenseHydrationConfig`, and `HostActivityConfig` types describe the complete groups while keeping each member optional on the base `HostConfig`.

## Root API

`createRenderer(hostConfig)` returns:

```ts
{
  createRoot,
  hydrateRoot,
  hydrateTarget,
  flushSync,
  batchedUpdates,
  scheduleRefresh,
}
```

A `FigRoot` exposes `{ data, render, unmount }`. Fibers and lanes never cross this boundary. Event priority uses the public string union, and `hydrateTarget` accepts one of those priorities.

`batchedUpdates` exists for renderer event dispatch and is not an application API. Application batching is automatic.

Creating two roots on one container throws. `unmount` runs synchronously so fiber cleanup completes while the data store is still alive, then releases the container for reuse.

Root options include `onUncaughtError`, `onRecoverableError`, `identifierPrefix`, `initialData`, `dataPartition`, and the development-only `devtools` option.

## Scheduler

The scheduler is internal. It runs work across macrotasks with five priority levels and starvation timeouts. Lane expiration handles aging at the update level; the scheduler's yield budget slices individual tasks.

It prefers `setImmediate`, then a lazily created browser `MessageChannel`, then `setTimeout`. Commit calls `requestPaint()` so the scheduler yields after visible mutations. A task may return a continuation callback to resume later.

No scheduler package or `unstable_` API is published.

## Development And Testing Subpaths

`@bgub/fig-reconciler/devtools` emits commit snapshots. `@bgub/fig-reconciler/refresh` swaps Fast Refresh component families while preserving state, or remounts when a hook signature changes.

`@bgub/fig-reconciler/test-utils` exports `act`. It shares the same scheduler instance as the renderer, so tests flush work scheduled through either entry.
