# Hooks

Status: stable

Fig keeps React's hook model but gives long-lived callbacks one consistent cleanup mechanism: `AbortSignal`.

## The Signal Contract

A callback that outlives its call site receives a signal and returns nothing. The signal aborts when that particular run no longer owns the work.

| Callback | Signal aborts on |
| --- | --- |
| `useReactive`, `useBeforePaint`, `useBeforeLayout` | dependency change, unmount, Activity hide |
| `bind` | identity change, unmount, Activity hide |
| `on()` handlers | re-entry, listener removal |
| `useStableEvent` handlers | re-entry, unmount, Activity hide |
| `useTransition` callbacks | superseding run, unmount, Activity hide |
| `ViewTransition.onTransition` | native view transition finishes |
| `useActionState` actions | superseding run, unmount, Activity hide |
| data-resource loaders | a newer value publishes, rejection, store disposal, entry eviction |

The signal is always the lifetime indicator. Fig callbacks never return cleanup functions.

## State

`useState` returns `[state, setState]`. The setter accepts a value or an updater function:

```ts
type StateSetter<S> = (next: S | ((previous: S) => S)) => void;
```

`StateSetter` is the one public setter type. Fig has no `Dispatch` or `SetStateAction` vocabulary and no `useReducer`; reducer helpers can be built over `useState` when an application needs them.

## Effects

The effect names describe when they run:

- `useBeforeLayout` runs before host mutations. It corresponds to React's `useInsertionEffect`.
- `useBeforePaint` runs after host mutations but before the browser paints. It corresponds to `useLayoutEffect`.
- `useReactive` runs later at normal priority. It corresponds to `useEffect`.

```tsx
useReactive((signal) => {
  const id = setInterval(tick, 1000);
  signal.addEventListener("abort", () => clearInterval(id));
}, []);
```

Effects must return `undefined`, so returning a React-style cleanup is a type error. There is no separate mount-only hook; use `useReactive(fn, [])`. Dependency arrays remain explicit because Fig does not require a compiler.

If another render starts before pending reactive effects run, Fig flushes those effects first. Effects also run with the ambient data store installed, so data APIs work during their synchronous body.

In development, scheduling state from `useBeforeLayout` throws before commit. That phase exists for insertion-style work, not updates. The error follows the normal effect-error path and may be caught by an ancestor ErrorBoundary.

## Stable Events

`useStableEvent(handler)` returns a function whose identity never changes but whose implementation always comes from the latest committed render.

The handler receives a trailing `AbortSignal`, but callers do not pass it:

```ts
(...args: [...Args, AbortSignal]) => Result
// becomes
(...args: Args) => Result
```

Handlers update at commit before `useBeforeLayout` runs. Calling one after unmount uses the last committed handler with an already-aborted signal. Calling one during client or server render throws, and the strict shadow render never publishes a handler.

Unlike React's `useEffectEvent`, Fig's stable events are not restricted to effects. Event handlers, timers, and subscriptions may all call them.

## Transitions

`transition(callback, options?)` and `useTransition()` mark lower-priority work. Callbacks receive `(signal, update)`. Synchronous updates inherit transition priority; after `await`, use `update(() => ...)` to re-enter the original transition. Async hook callbacks keep `isPending` true until they settle and their scheduled updates commit. Both the top-level function and the hook's `start` function accept `{ types?: readonly string[]; viewTransition?: "interrupt" }`; native animation types and interruption are described in the [View Transitions concept](./view-transitions.md#transition-options).

Transitions on unrelated state queues can render and commit independently within one root. When one transition suspends under an already-revealed Suspense boundary, it retains its previous content without holding a ready sibling transition or that sibling's pending indicator.

Updates assigned to one transition lane render together. Pending transitions that update the same state queue are entangled: they render together, including other updates in those transitions. This lets newer selections supersede older ones without exposing half of a related update. Dependencies are transitive across shared queues and are retired when work completes. Sync/default updates retain their higher priority and queue rebasing behavior.

Independence is a scheduling policy, not a promise of a separate lane for every operation: the finite lane pool can reuse a pending lane. Each explicit `update` re-enters its captured lane even when other async callbacks are pending. Unwrapped post-`await` setters and unrelated events use their ordinary scheduling priority; pending promises never establish an ambient transition lane.

```tsx
const [isPending, start] = useTransition();
start(async (signal, update) => {
  const results = await fetchResults({ signal });
  update(() => {
    setResults(results);
    setSelectedResult(null);
  });
});
```

`update` runs its callback synchronously and restores the previous priority and data-store context afterward, including on throw. It also restores the data store captured when the transition began, so free data APIs work inside it. An async `update` callback is invalid and throws; await outside it and call `update` again for each synchronous group of updates. Errors from a live update propagate to its caller.

The returned callback promise defines the scope lifetime. The signal aborts and the entire `update` callback becomes inert when the callback settles, throws, or is cancelled. Synchronous callbacks close on return. A saved `update` handle cannot extend that lifetime; return or await all asynchronous work that needs it. Signal retirement does not mean all scheduled work has committed.

A ready commit may still wait for an active browser View Transition. Related updates continue to coalesce while that commit is parked; see [View Transitions](./view-transitions.md#one-transition-at-a-time).

Each `useTransition` hook is one cancellation domain. Starting another run aborts and retires the previous one:

- its pending slot releases immediately;
- its eventual rejection is swallowed; and
- state it already committed stays committed.

Unmounting the owner or hiding its enclosing Activity also retires the run. Abort is a signal to stop, not an undo operation: already committed state stays committed, and arbitrary code outside `update` is not suppressed. A stale starter called after unmount receives an already-aborted signal and an inert update handle.

Top-level `transition()` uses the same `(signal, update)` contract and returns the callback result unchanged. Its lifetime follows callback settlement; it has no hook owner to supersede or unmount. Server and renderer-free scopes use the same callback lifetime, without client scheduling.

## Actions

`useActionState(action, initialState)` keeps React's argument order and adds an `AbortSignal` after the runner's arguments. Declare that final parameter so TypeScript can infer the argument tuple.

Actions are last-run-wins. A generation counter prevents a retired run from changing state, error, or pending status after a newer run starts. Fig does not use React 19's serial action queue. The signal also aborts when the action settles. Fig schedules the returned value in the action’s own transition lane automatically; arbitrary post-`await` setters inside the action have ordinary priority. Server action transport belongs to framework integrations.

## Other Hooks

- `useMemo` and `useCallback` preserve values and callback identities.
- `useDeferredValue` renders a lower-priority version of a value.
- `useSyncExternalStore` requires `getServerSnapshot` during server rendering and hydration. Hidden Activity subscriptions wait until reveal.
- `useId` creates SSR-stable ids under the root's `identifierPrefix`. Server rendering and hydration derive ids from the same canonical element path. A dehydrated Suspense or Activity boundary preserves that path across intervening client updates, while purely client-mounted components use the separate `fig-C-*` namespace.
- There is no `useRef`. Use `useMemo(() => ({ current: null }), [])` for mutable storage and `bind` for DOM access.

## Read Verbs Are Not Hooks

React's broad `use(resource)` becomes three explicit operations:

- `readContext(context)` reads a render-time context value.
- `readPromise(promise)` reads by promise identity.
- `readData(resource, ...args)` reads by data-resource key.

They do not consume hook slots. Context reads still participate in bailout invalidation: if a provider value changes, Fig finds and schedules the consumers that would otherwise be skipped, stopping at nested providers of the same context.

A promise used directly as a child is read implicitly because its child position already tells Fig where the result belongs. Use `readPromise` when a promise value affects props or branching instead.

Client-created promises must keep the same identity across retries. Memoize them or use a data resource rather than creating a fresh `.then(...)` chain during every render.
