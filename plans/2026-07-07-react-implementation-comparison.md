# React Implementation Comparison

Date: 2026-07-07

React source inspected from a shallow clone at:

- Path: `/tmp/react-inspect-BPjkCj/react`
- Commit: `12a4baeca157fa8ae0cbd6463595ea7f3af10c26`

This note compares React's implementation patterns against Fig's current
reconciler, DOM hydration/event, server rendering, and payload code. It focuses
on logic, tree traversal, subtree bailout, Suspense, and payload serialization:
areas where React's implementation likely reflects substantial performance
iteration.

## Executive Summary

The largest React patterns worth drawing from are:

1. React's context consumers keep memoized dependency entries, giving bailout
   logic a direct way to detect context changes.
2. React's external-store consistency checks are stored on the consuming fiber
   and pruned by `subtreeFlags`.
3. React's selective hydration and event replay are target-instance based, not
   root-search based.
4. React Fizz's Suspense task/segment model is closely aligned with where Fig
   has moved recently.
5. React Flight and Fig payload serialization now share the important invariant
   that nested containers recurse through the same serializer rather than
   becoming opaque values.

## 1. Context Dependencies

React records context dependencies as a linked list on the consuming fiber:

- each entry includes the context and the memoized value read during render.
- context propagation marks matching consumers and their parent path with lanes.
- bailout can call `checkIfContextChanged` to compare memoized values against
  current provider values before skipping.

Relevant React file:

- `packages/react-reconciler/src/ReactFiberNewContext.js`
  - `pushProvider`
  - `popProvider`
  - `readContextForConsumer`
  - `checkIfContextChanged`
  - `propagateContextChanges`

Fig records context dependencies as an array of contexts:

- `readContextValue` records the context in `contextDependencies`.
- provider changes walk the previous provider subtree, mark matching consumers,
  and mark their parent path.
- nested providers stop propagation for the same context.

Relevant Fig file:

- `packages/fig-reconciler/src/index.ts`
  - `readContextValue`
  - `addContextDependency`
  - `propagateContextChange`
  - `markContextConsumers`

Fig's current model is smaller and easier to reason about. React's memoized
dependency values become more valuable if Fig expands bailout paths or wants
more lazy context propagation.

Recommended follow-up:

- Do not immediately port React's linked-list dependency structure.
- If context and bailout interactions keep growing, replace
  `FigContext[]` with dependency entries containing `{ context, memoizedValue }`.

## 2. External Store Consistency

React's `useSyncExternalStore` reads the snapshot during render and, for
non-blocking non-hydrating renders, stores a consistency check on the consuming
fiber. Before commit, React traverses only branches marked with
`StoreConsistency` and verifies snapshots did not change concurrently.

Relevant React files:

- `packages/react-reconciler/src/ReactFiberHooks.js`
  - `mountSyncExternalStore`
  - `updateSyncExternalStore`
  - `pushStoreConsistencyCheck`
- `packages/react-reconciler/src/ReactFiberWorkLoop.js`
  - `isRenderConsistentWithExternalStores`

Fig has an external store registry and subscription machinery. The current
shape works, but React's design is more local: the fiber that read the store
also owns the render-time consistency check, and traversal is pruned by
subtree flags.

Recommended follow-up:

- Consider moving Fig's pre-commit external store consistency checks toward
  per-fiber queued checks.
- Use Fig's existing `subtreeFlags` pruning so consistency checks avoid clean
  branches.

## 3. Hydration And Event Replay

React's hydration event path is target-instance based:

- event dispatch asks which instance blocks the target.
- if blocked by a dehydrated Suspense/activity instance, React attempts
  hydration of that specific fiber/boundary.
- replayable events store `blockedOn`.
- when a boundary hydrates or is removed, React calls `retryIfBlockedOn` for
  that exact instance.

Relevant React files:

- `packages/react-dom-bindings/src/events/ReactDOMEventListener.js`
  - `dispatchEvent`
  - `findInstanceBlockingEvent`
  - `attemptSynchronousHydration`
- `packages/react-dom-bindings/src/events/ReactDOMEventReplaying.js`
  - `queueIfContinuousEvent`
  - `attemptExplicitHydrationTarget`
  - `retryIfBlockedOn`
- `packages/react-dom-bindings/src/events/DOMPluginEventSystem.js`
  - `listenToAllSupportedEvents`
- `packages/react-dom-bindings/src/client/ReactFiberConfigDOM.js`
  - hydration boundary cleanup/retry hooks

Fig's event system now has explicit hydration listeners, delegated listener
lifetime management, and replay queues. The remaining structural difference is
boundary discovery:

- Fig resolves blocked hydration by recursively searching the current tree for a
  dehydrated Suspense boundary containing the event target.
- React maps DOM instances back to fibers/boundaries, avoiding a full tree
  search on event paths.

Relevant Fig files:

- `packages/fig-dom/src/events.ts`
  - `installHydrationEventListeners`
  - `hydrateForEvent`
  - `replayQueuedEvents`
  - `dispatchReplayedEvent`
- `packages/fig-reconciler/src/index.ts`
  - `findDehydratedSuspenseBoundaryForTarget`
- `packages/fig-dom/src/suspense-markers.ts`
  - `suspenseBoundaryForMarker`
  - `isWithinSuspenseBoundary`

Recommended follow-up:

- Introduce a host/reconciler seam that lets DOM nodes resolve directly to the
  nearest dehydrated boundary or owning fiber.
- Keep the current recursive search as a fallback while validating the mapping.
- Add tests for many dehydrated boundaries where an event targets the last
  boundary, then assert the lookup does not scan unrelated earlier boundaries.

## 4. Suspense And Server Rendering

React Fizz treats suspended work as task/segment work:

- rendering a node snapshots task context.
- if the node suspends, React truncates writes to the previous segment position,
  spawns a new suspended task with a new child segment, restores context, and
  continues rendering siblings.
- task state carries key path, tree context, format context, legacy/context
  snapshot, row state, component stack, and hoistable state.

Relevant React file:

- `packages/react-server/src/ReactFizzServer.js`
  - `createRenderTask`
  - `renderChildrenArray`
  - `spawnNewSuspendedRenderTask`
  - `renderNode`
  - `retryTask`

Fig's server renderer now has the same important shape:

- `renderChildSequence` catches thenables per child.
- `spawnSuspendedTask` creates resumed work for the suspended child.
- `forkScope` clones context values and preserves id path state for spawned or
  resumed work.

Relevant Fig file:

- `packages/fig-server/src/renderer.ts`
  - `renderChildSequence`
  - `createTask`
  - `forkScope`
  - `renderSuspense`
  - `completeBoundaryIfReady`

Fig does not need to port Fizz wholesale. The useful React validation is that
Fig's current direction is likely right: a suspension in one child should not
block starting later siblings, and suspended tasks must carry all render-context
state required for stable ids and provider values.

Recommended follow-up:

- Keep adding server-rendering regression tests around stable ids, provider
  values, and nested Suspense when siblings suspend independently.
- If streaming behavior grows, consider whether Fig needs a more explicit
  `treeContext`/`keyPath` split instead of one `idPath` scope field.

## 5. Payload / Flight Serialization

React Flight serializes Maps and Sets by outlining their entries as normal
models:

- `serializeMap` outlines `Array.from(map)`.
- `serializeSet` outlines `Array.from(set)`.
- those outlined models recurse through `renderModel` /
  `renderModelDestructive`.
- `writtenObjects` tracks shared values and references across the payload.

Relevant React file:

- `packages/react-server/src/ReactFlightServer.js`
  - `renderModel`
  - `renderModelDestructive`
  - `serializeMap`
  - `serializeSet`
  - `writtenObjects`

Fig's payload codec now follows the same key invariant:

- `serializeValue` recurses into Map keys and values with `serializeValue`.
- `serializeValue` recurses into Set entries with `serializeValue`.
- graph references preserve cycles and shared object identity.
- client references, thenables, and elements inside nested containers are not
  treated as opaque plain data.

Relevant Fig file:

- `packages/fig-server/src/payload.ts`
  - `serializeValue`
  - `serializeMap`
  - `serializeSet`
  - `decodeSpecialModel`
  - object reference retention helpers

Recommended follow-up:

- Keep this area stable unless new payload value types are added.
- For every new container/value type, require tests that nest client references,
  promises, server elements, shared objects, and cycles inside that value type.

## 6. Prioritized Candidate Work

Highest priority:

1. Move hydration blocked-boundary lookup toward target-instance mapping.

Medium priority:

2. Consider memoized context dependency entries if bailout/context logic grows.
3. Consider per-fiber external-store consistency checks using `subtreeFlags`.

Lower priority:

4. Keep Fizz comparison as validation rather than a direct port.
5. Keep payload behavior aligned through regression tests when adding new model
   types.

## Suggested Regression Tests

Potential tests before implementation:

- A replayable hydration event targeting the last of many dehydrated Suspense
  boundaries resolves the boundary directly.
- An external store changed between render and commit triggers a rerender
  without scanning clean branches.
- Payload nested containers continue to round-trip client references, promises,
  elements, shared values, and cycles.
