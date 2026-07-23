# Error Handling

Status: stable

Fig separates errors into three paths: errors a component can recover from, errors the root must report, and cancellations that are not errors at all.

## ErrorBoundary

`ErrorBoundary` is a component, not a class protocol. It catches render errors and Fig effect errors, then keeps showing its fallback until the boundary remounts or its key changes.

The fallback may be a node or a function receiving `(error, info)`. `onError(error, info)` is available for reporting. `ErrorInfo` contains a component stack and, for data errors, the affected `dataResourceKeys`.

An `ErrorBoundary` does not catch:

- promises, which belong to Suspense;
- event-handler or other async callback errors;
- server-render errors, which use client-render markers; or
- host commit failures.

## Retrying Data Errors

The normal recovery loop has no special side channel:

1. `readData` throws the loader error.
2. `ErrorBoundary` renders a retry button.
3. The button calls `invalidateDataError(error)` or `invalidateDataKey(key)`.
4. The UI changes the boundary key, remounting it.
5. The new read starts a fresh load.

Invalidation resets a cached rejection to pending. Remounting resets the boundary's sticky fallback. Both steps matter.

## Uncaught Errors

An uncaught render error is rethrown to a `flushSync` caller. Outside `flushSync`, it goes to the root's `onUncaughtError`. If the root has no handler, Fig rethrows it from a detached task so a scheduler tick never swallows the failure.

Hydration recovery reports through `onRecoverableError`. Fig DOM does not provide React's root-level `onCaughtError`; a boundary's `onError` prop owns caught-error reporting.

## Server Errors And Digests

Server errors cross the wire only through:

```ts
onError(error, info) => ({ digest, message })
```

The returned object is authoritative. Production sends nothing by default; development includes the message. HTML client-render markers carry `data-dgst` and `data-msg`, while Payload error rows reject their chunk with a digest-carrying error.

## Errors Inside Payload Holes

A decoded Payload root may be ready while streamed subtrees inside it are still pending. If one of those holes fails, the nearest `ErrorBoundary` around that slot catches it. The surrounding root value remains usable.

Payload component decoding attributes the hole error to the data-resource generation that owns the decoded tree. This makes `ErrorInfo.dataResourceKeys` and `invalidateDataError(error)` work exactly as they do for a root loader failure. Errors from an obsolete generation are ignored.

## Cancellation Is Not An Error

Transitions, actions, data loads, and Payload decoding all retire aborted work. An expected abort rejection is swallowed, and the retired work cannot publish state later. Only failures from the current live generation reach boundaries or uncaught-error paths.
