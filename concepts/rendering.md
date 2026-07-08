# Rendering

Status: stable

Elements, fibers, render bailouts, strict development rendering, and
pre-commit diagnostics.

## Element Model

Elements are plain objects branded with `$$typeof` (string-keyed symbol
values, the JSON-injection defense). `FigNode` is the one public children
type — elements, portals, text, booleans, `null`/`undefined`, and arrays;
there is no `FigChild`/`ReactChild`-style duplicate. Components are plain
functions; `Fragment` is a symbol; `Suspense`/`Activity`/`ErrorBoundary`/
`Assets` are callable-with-brand objects so they typecheck as ordinary
components. `lazy(load)` expects the loader to return the component itself —
no `{ default }` unwrapping, no special element type; it is a plain component
over `readPromise`.

Portals (`createPortal(children, target, key?)`) render into explicit DOM
targets while remaining logical children: context, effects ordering, error
propagation, and delegated event bubbling all follow the Fig tree, not the
DOM position (see events.md for the delegation mechanics).

Child normalization (shared verbatim with the server renderer — see
architecture.md) flattens arrays, drops `null`/`undefined`/booleans, and
merges adjacent text (numbers stringify). The normalized member type is
`NormalizedChild = element | portal | string`.

## Render Bailouts (Two Tiers)

A fiber with identical props, no own work in the render lanes, and no changed
context reads is never re-rendered:

1. When its `childLanes` are also clean, it **adopts** the committed children
   without cloning (`AdoptedFlag`); render and the commit mutation/deletion/
   effect walks all skip the subtree.
2. When descendants have work, its children are cloned and traversal
   descends — preserving child props identity so siblings bail too.

Context propagation is lazy: a provider pushes its new value and renders on
without walking its subtree, so the cost lands only where a subtree would
otherwise be skipped. Each `readContext` records the value it saw on the
consuming fiber, and a consumer whose recorded value no longer matches the
current provider value is refused bailout outright. Before tier 1 adopts a
subtree, the skip point checks the providers above it for changed values and
lane-marks the matching consumers it was about to skip — pruned by per-fiber
context aggregates maintained at complete-time like `subtreeFlags`, stopping
at nested providers of the same context. A per-render flag records that the
skip point ran this check so nested skip points end their upward walk early.

Suspense boundaries always run `begin` so hidden-primary retries are handled.
Commit clears fiber flags and deletions as it consumes them, so adopted
subtrees never re-expose already-committed state. These tiers are why Fig has
no `memo()`: identity-preserved children bail automatically, and
`useMemo(() => <X/>, deps)` covers deliberate subtree pinning.

## Strict Development Rendering

There is no `StrictMode` component and no opt-out: development always
strict-renders. Each render pass invokes the component twice — a shadow pass
whose hooks, effects, and consumed update queues are discarded and restored,
with no reconciliation — and commits only the second invocation. Effects and
fig-dom `bind` callbacks run, abort, and run again with a fresh signal once
per lifetime (tracked via `strictRan` flags set before the first call so
re-entrant runs cannot re-enter the cycle). Strict behavior is client-only —
server rendering never double-invokes — and production builds strip all of it.

## Pre-Commit Diagnostics

Render diagnostics throw before commit rather than warning after it:
duplicate sibling keys, invalid children, render-phase state updates, and
invalid DOM nesting. Nesting rules live in `@bgub/fig/internal`
(`dom-nesting.ts`) and run on both sides — the client validates at fiber
creation (ancestors seeded from portal targets and root containers via the
`containerType` host hook); the server threads an ancestor stack through
render frames so suspended segments validate against their logical position.
The checks model HTML parser scoping (button/table scope boundaries,
li/dd/dt implied end tags); whitespace-only text and hoisted asset resources
are exempt.

## Commit And Batching

Batching is automatic with no opt-in API: same-tick updates and root renders
coalesce into one pass; `flushSync` is the only escape hatch. After host
mutations land, commit calls the scheduler's `requestPaint()` so the work
loop yields before further scheduled work runs. Uncaught render errors
rethrow to `flushSync` callers; outside `flushSync` they go to the root's
`onUncaughtError`, or rethrow from a detached task when no handler exists —
scheduler ticks never die silently.

## Testing Flushes

`act(callback)` is a scheduler-backed test helper. While an act scope is open,
Fig scheduler callbacks are queued instead of posted to host APIs. The
outermost scope waits for the callback, drains queued work by scheduler
priority, runs continuation callbacks, and repeats after microtask/macrotask
turns until no Fig work is scheduled. This covers root renders, state updates
after awaited code inside the callback, effect work scheduled by commits, and
Suspense retries that ping before `act` resolves. It does not advance arbitrary
application timers; tests that depend on timers still own those timers.
