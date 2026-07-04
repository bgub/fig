# Hooks

Status: stable

The hook surface, the AbortSignal contract, and the deliberate omissions.

## The Signal Contract

Every Fig callback that outlives its call site receives an `AbortSignal`
instead of returning a cleanup function; the aborted signal is always the
indicator. Where each signal aborts:

| callback                                                   | aborts on                                      |
| ---------------------------------------------------------- | ---------------------------------------------- |
| effects (`useReactive`/`useBeforePaint`/`useBeforeLayout`) | dependency change, unmount, Activity hide      |
| `bind={(node, signal) => ...}` (fig-dom)                   | identity change, unmount, Activity suspend     |
| event handlers (`on(type, (event, signal) => ...)`)        | re-entry, listener removal                     |
| `useStableEvent` handlers                                  | re-entry, unmount, Activity hide               |
| `useTransition` callbacks                                  | supersede (same hook), unmount, Activity hide  |
| `useActionState` actions                                   | supersede (same hook), unmount, Activity hide  |
| data loaders (`DataResourceLoadContext.signal`)            | superseded load, store dispose, entry eviction |

## State

`useState` returns `[S, StateSetter<S>]` — one named setter type,
`(next: S | ((previous: S) => S)) => void`. There is no `Dispatch`/
`SetStateAction` reducer vocabulary and no `useReducer`: reducer abstractions
are userland over `useState`.

## Effects

`useReactive` (useEffect), `useBeforePaint` (useLayoutEffect), and
`useBeforeLayout` (useInsertionEffect) are named for when they run. Effects
must return `undefined` — the type makes a React-style returned cleanup a
compile error. There is no mount-only hook; `useReactive(fn, [])` is the
idiom. Dependency arrays are the honest choice without a compiler; the signal
is for cleanup, not tracking. Effects run with the ambient data store set, so
data APIs work synchronously inside them.

## Stable Events

`useStableEvent(handler)` is the general escape-from-reactivity primitive
(React's `useEffectEvent` shape with the Fig signal contract; "stable" names
the identity guarantee). The returned function's identity never changes; the
handler always sees the latest committed render. Handlers swap at commit
before the before-layout effect phase; calls after unmount run the last
committed handler with an already-aborted signal; calling one during render
or server render throws; the strict shadow pass never publishes. Unlike
React's, it is not restricted to effects — handlers, timers, and
subscriptions are all valid callers.

## Transitions And Actions

`transition(callback)` and `useTransition()` are explicit priority scopes;
async callbacks keep `isPending` true until they settle, and post-`await`
updates stay in scope (async transition lanes are held until the callback
settles so their updates commit atomically).

`useTransition` callbacks receive an `AbortSignal`. Each hook is one
cancellation domain: starting a new transition aborts and _retires_ the
previous pending run. A retired run's pending slot releases immediately (an
ignored signal or hung promise can never pin `isPending`), its rejection is
swallowed (an aborted fetch rejecting is the happy path), and state it
already set stays committed — aborting is a signal, not an unwind. Retire
bookkeeping schedules on the default lane because the retired run's own
transition lane may never render. Top-level `transition()` has no signal: no
hook identity to supersede, no lifetime to unmount.

`useActionState(action, initialState)` keeps React's argument order; Fig
appends a trailing `AbortSignal` after the runner's args (the data-loader
tuple shape — declare the signal parameter; it drives `Args` inference).
Runs are last-run-wins, guarded by a generation counter: a retired run's
settlement (value or rejection) can never touch state, error, or pending.
There is no React-19-style serial action queue. Server action transport is
left to framework layers.

## Other Hooks

- `useMemo`/`useCallback` — stable values and callback identities.
- `useLaggedValue` (useDeferredValue) — "lagged" describes the observable
  behavior.
- `useExternalStore(subscribe, getSnapshot, getServerSnapshot?)` — server
  render and hydration require `getServerSnapshot`; subscriptions under
  hidden Activity defer until reveal.
- `useId` — SSR-stable ids with the root's `identifierPrefix`.
- No `useRef`: `useMemo(() => ({ current: null }), [])` for mutable storage,
  `bind` for DOM access.

## Read Verbs (Not Hooks)

React's broad `use(resource)` splits into explicit reads that are render-time
inputs, not hook slots: `readContext(context)` (context objects are their own
provider; reads are tracked so provider updates mark matching consumers, and
propagation stops at nested providers of the same context), `readPromise`
(identity-keyed, not call-position-keyed), and `readData` from
`@bgub/fig-data` (cache-keyed — see data.md).
