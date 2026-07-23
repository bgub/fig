# Rendering

Status: stable

Rendering turns Fig elements into host nodes. It may pause, restart, or reuse existing work, but commit is the only phase allowed to change the host environment.

For a gentler introduction to fibers and lanes, read [Fiber architecture](../2-fiber-architecture.md).

## Elements And Children

Elements are plain objects branded with a string-keyed `$$typeof` symbol. `FigNode` is the one public children type: elements, portals, promises, text, booleans, empty values, and arrays. `AwaitedFigNode` exists only for APIs whose outer promise must assimilate a root thenable; it is not another children type.

`Fragment` is a symbol. `Suspense`, `Activity`, `ErrorBoundary`, `Assets`, and `ViewTransition` are branded callable values so TypeScript treats them like components.

`lazy(load)` is a component built over `readPromise`. Its loader returns the component itself—there is no `{ default }` unwrapping—and preserves that component's props.

Portals render into another host container but remain children in the logical Fig tree. Context, effects, errors, and event bubbling follow that logical position.

## Child Normalization

Client and server rendering share the same normalization code. It:

- flattens arrays;
- removes booleans, `null`, and `undefined`;
- converts numbers to text;
- merges adjacent text from one children array; and
- keeps each promise as its own child slot.

The internal union is `element | portal | thenable | string`.

A promise child gets its own fiber but adds no DOM wrapper. Pending promises suspend, fulfilled values render in that slot, and rejected or invalid values reach `ErrorBoundary`. Even an empty result keeps the slot so reconciliation and hydration agree about where it was.

Promise identity is the slot's async identity. Server renderers retain the exact promise in their task, and Payload decoding produces stable promises. Client code must also preserve identity across retries:

```tsx
const child = useMemo(() => loadPanel(id), [id]);
return <Suspense fallback={<Spinner />}>{child}</Suspense>;
```

Creating a new promise on every render continually replaces the pending work. Direct async client components have the same problem and are unsupported. Promise slots have no key, so wrap one in a keyed Fragment when promises can reorder.

## Bailouts

Fig skips a fiber when its props are identical, it has no work in the current lanes, and none of its context reads changed.

There are two cases:

1. If descendants are also clean, Fig adopts the committed children without cloning them. Render and commit walks skip the whole subtree.
2. If a descendant has work, Fig clones the immediate children and descends. Unchanged siblings keep their prop identity and bail out naturally.

This is why Fig has no `memo()`. Stable child identity already skips unchanged siblings; `useMemo(() => <Panel />, deps)` can deliberately pin a larger subtree.

Context invalidation is lazy. Providers do not eagerly walk their entire subtree. Each consumer records the value it read, and a would-be skip point checks changed providers before adopting the subtree. Per-fiber context summaries prune that search and nested providers stop it.

Suspense boundaries always run their begin phase because hidden primary content may need a retry.

## Strict Development Rendering

Development is always strict; there is no `StrictMode` component or opt-out.

Each component invocation runs once as a shadow pass and once for real. Fig discards the shadow hooks, effects, and consumed update queues. First-time effects and binds also run, abort, and run again with a fresh signal.

Server rendering never double-invokes. Production removes the client checks through compile-time `__FIG_DEV__` gates.

## Diagnostics Before Commit

Duplicate keys, invalid children, render-phase state updates, and invalid DOM nesting throw before commit instead of warning afterward.

Client and server rendering share the nesting tables. They model browser parser behavior such as table scope, nested buttons, and implied closing of `li`, `dd`, and `dt`. Whitespace-only text and hoisted assets are exempt.

Portal validation starts from the portal target's host ancestors. Server tasks carry the logical ancestor stack across suspension.

## Hydration Tails

Normally, hydration must consume every ordinary server node. A renderer may allow unmatched nodes in host-owned singleton containers through `canRetainHydrationTail`.

Fig DOM permits this for `<html>`, `<head>`, and `<body>`, where extensions may append unrelated nodes before hydration. Those nodes remain outside Fig and are never updated or removed by reconciliation.

## Commit And Batching

Batching is automatic. Updates from the same tick and root renders coalesce; `flushSync` is the escape hatch. After mutations, commit calls `requestPaint()` so the scheduler yields before starting more work.

Fig records fiber-local commit work in a sparse per-root index during render. Effects, data subscriptions, external stores, deletions, caught errors, live hooks, and ordinary host updates can then commit without scanning the entire finished tree.

The index is an optimization, not a second source of truth:

- each fiber appears at most once;
- a Suspense or error capture truncates entries created by its discarded subtree;
- render restart and commit clear the index; and
- development builds compare indexed behavior with the original tree walks.

Placements, visibility changes, and hydration still use flags and pruned tree walks because their order depends on host structure. First commits stay on those paths as well. Updates to already committed host and text instances use the sparse index.

View transitions assign indexed mutations to the nearest transition boundary, to the root, or to nothing when a portal breaks ownership. This avoids another subtree walk without changing which mutations count.

## Suspense Retries

Every suspension installs two kinds of wake-up:

- A root-level ping is attached during render. If that render is restarted or abandoned, resolving the promise can still revive the suspended lanes.
- A targeted boundary retry is recorded during render but attached only after commit, when the boundary fiber is known to be current.

Fig never trusts a fiber identity captured from unfinished work. A render may restart, reuse a fiber in place, or discard it entirely.

Deletion severs the removed subtree's parent links after cleanup. A late retry or stale setter then fails to find a root and becomes a no-op instead of scheduling phantom work.

Render and commit paths still treat a missing root as an invariant violation. APIs callable after unmount must tolerate it.

## Testing With `act`

While an `act` scope is open, Fig queues scheduler callbacks instead of posting them to the host. The outermost scope waits for the callback, drains work by priority, runs continuations, and repeats across microtask and macrotask turns until Fig has no scheduled work.

This covers renders, effects, updates after awaited code inside the callback, and Suspense retries that ping before `act` finishes. It does not advance arbitrary application timers.
