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

The remaining React patterns worth drawing from are validation-level:

1. React Fizz's Suspense task/segment model remains useful validation for
   Fig's server-rendering shape.
2. React Flight and Fig payload serialization share the important invariant
   that nested containers recurse through the same serializer rather than
   becoming opaque values.

## 1. Suspense And Server Rendering

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

## 2. Payload / Flight Serialization

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

## 3. Prioritized Candidate Work

Lower priority:

1. Keep Fizz comparison as validation rather than a direct port.
2. Keep payload behavior aligned through regression tests when adding new model
   types.

## Suggested Regression Tests

Potential tests before implementation:

- Payload nested containers continue to round-trip client references, promises,
  elements, shared values, and cycles.
