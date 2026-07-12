# Error Handling

Status: stable

Boundaries, digests, uncaught routing, and the recovery loop.

## ErrorBoundary

A component, not a class protocol. It catches render errors and Fig effect errors with a sticky fallback; reset by remounting/changing the boundary key. `fallback` may be a function receiving `(error, info)` so error UIs render the failure directly (a bare function is never a valid `FigNode`, so the shapes cannot collide); `onError(error, info)` is the side channel for reporting. `ErrorInfo` carries `componentStack` and, for data-originated errors, `dataResourceKeys` (see data.md).

Boundaries do **not** catch: promises (that is Suspense), event handler errors, async callback errors, server render errors (those recover through client-render markers), or host commit failures.

## The Recovery Loop

"Fetch failed → show error → retry" composes without side channels: `readData` throws the real error into the boundary; the function `fallback` renders it with a retry affordance; retry calls `invalidateDataError(error)` or `invalidateDataKey(key)` (which reset cached rejections back to pending) and remounts the boundary by key; the fresh read loads afresh.

## Uncaught Routing

Uncaught render errors rethrow to `flushSync` callers; outside `flushSync` they go to the root's `onUncaughtError`, or rethrow from a detached task when no handler exists — scheduler ticks never die silently. Hydration recoveries report through the root's `onRecoverableError` with digests. Fig-dom omits React's root-level `onCaughtError` in favor of the per-boundary `onError` prop.

## Server Digests

Server render errors cross the wire only through `onError(error, info) => { digest?, message? }` — authoritative payload, production-empty by default, shared by the HTML and payload renderers (see server-rendering.md). Client-render markers carry the digest into hydration (`data-dgst`/`data-msg`), and payload error rows reject their chunk with a digest-carrying error.

## Cancellation Is Not An Error

Across transitions, actions, and data loads, an aborted run is _retired_: its rejection is swallowed (an aborted fetch rejecting is the happy path) and its settlement cannot touch state. Only live-generation failures reach boundaries or rethrow paths. See hooks.md and data.md.
