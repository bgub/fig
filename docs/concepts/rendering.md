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
- removes booleans, `null`, `undefined`, and empty strings;
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

Each component invocation runs once as a shadow pass and once for real. Fig discards the shadow hook state and effects; queue reads never consume incoming updates. First-time effects and binds also run, abort, and run again with a fresh signal.

Server rendering never double-invokes. Production removes the client checks through compile-time `__FIG_DEV__` gates.

## Diagnostics Before Commit

Duplicate keys, invalid children, render-phase state updates, and invalid DOM nesting throw before commit instead of warning afterward.

Client and server rendering share the nesting tables. They model browser parser behavior such as table scope, nested buttons, and implied closing of `li`, `dd`, and `dt`. Whitespace-only text and hoisted assets are exempt.

Portal validation starts from the portal target's host ancestors. Server tasks carry the logical ancestor stack across suspension.

## Hydration Tails

Normally, hydration must consume every ordinary server node. A renderer may allow unmatched nodes in host-owned singleton containers through `canRetainHydrationTail`.

Fig DOM permits this for `<html>`, `<head>`, and `<body>`, where extensions may append unrelated nodes before hydration. Those nodes remain outside Fig and are never updated or removed by reconciliation.

## Commit And Batching

Batching is automatic. Updates from the same tick and root renders coalesce; `flushSync` is the escape hatch. Root renders are queued by lane and rebased like component state. An urgent child update uses committed root props while a lower-priority root render remains pending; replaying skipped work cannot overwrite a newer synchronous root render. Root queues are processed inside the root work unit, after retiring its consumed lanes, just like component queues. Each queue reads through a captured position in its update history without removing updates. Commit acknowledges only that observed prefix; updates arriving later remain pending. Abandoned renders and strict shadow passes discard their candidate state without restoring queues. Priority rebasing retains skipped updates and replays subsequent applied updates in dispatch order. After mutations, commit calls `requestPaint()` so the scheduler yields before starting more work.

Root renders and state, transition, and action hooks carry update queues and rebase state. Other hook kinds retain only their own value or lifecycle state, without allocating unused queues.

Fig records fiber-local commit work in a sparse per-root index during render. Effects, data subscriptions, external stores, deletions, caught errors, live hooks, and ordinary host updates can then commit without scanning the entire finished tree.

The index is an optimization, not a second source of truth:

- each fiber appears at most once;
- a Suspense or error capture rolls back one attempt checkpoint, releasing discarded reads and boundary retries alongside indexed work;
- Suspense re-indexes preserved hook owners when moving the primary tree into hidden state, so stable-event visibility publishes before before-layout effects;
- render restart and commit clear the index; and
- development builds compare indexed behavior with the original tree walks.

Placements, visibility changes, and hydration still use flags and pruned tree walks because their order depends on host structure. First commits stay on those paths as well. Updates to already committed host and text instances use the sparse index.

View transitions assign indexed mutations to the nearest transition boundary, to the root, or to nothing when a portal breaks ownership. This avoids another subtree walk without changing which mutations count.

## External Store Consistency

Before committing concurrent work, Fig rechecks the external-store snapshots and data-resource values recorded by visible components in the render attempt. A mismatch or snapshot error discards the speculative tree and retries synchronously before host mutations or effects publish it. This also applies when `flushSync` finishes work that previously yielded, or when a finished tree resumes after being parked by a commit coordinator. A coordinator that delays the mutation transaction revalidates once more at mutation time. Stale transactions release their prepared capture without publishing hooks, effects, host mutations, or capture callbacks; fresh work is then scheduled. Fresh synchronous renders do not need the additional yield-consistency pass. Only client external-store reads register consistency observations with the render attempt. Server-snapshot reads register subscription work without a precommit client-snapshot check, preserving the hydration contract even after a selective hydration cursor clears. Their subscriptions reconcile the client snapshot after hydration commits. Client snapshot reads in the same transaction still undergo consistency validation.

Data-resource subscription commit also compares the recorded values after subscriptions are installed. If commit callbacks changed data before its reader subscribed, the reader is scheduled again: synchronously for visible content, or at offscreen priority for hidden content. The commit completes before this correction runs; deferred captures release before the correction can publish.

Subscription teardown clears ownership before invoking user cleanup, so reentrant notifications and throwing cleanups cannot reuse a retired subscription. Subscription-time snapshot errors schedule the consuming component instead of escaping the store notification callback, allowing its ErrorBoundary to handle the error during render. This follows React's [precommit consistency validation](https://github.com/facebook/react/blob/278794d7dee9cd2a3a2aaf9f0b2a4b8b747d74ee/packages/react-reconciler/src/ReactFiberWorkLoop.js) and [snapshot-change detection](https://github.com/facebook/react/blob/278794d7dee9cd2a3a2aaf9f0b2a4b8b747d74ee/packages/react-reconciler/src/ReactFiberHooks.js).

## Suspense Retries

When a fallback preserves an already committed primary, commit releases the original lane ownership of the updates that primary attempted, including pending prefixes and updates already retained in committed rebase history. This makes the complete attempted state eligible for retry without first revealing stale state. Each read retains the lanes of its attempt; updates that render skipped, or that arrived after its read boundaries, retain their priority. Preserved clones do not count as new reads. Discarding a fallback before commit changes neither incoming queue history nor committed rebase history. Skipped queue entries also retain their owner's pending lanes, so an urgent reveal neither publishes half of a transition nor strands its remaining updates.

Every suspension installs two kinds of wake-up:

- A root-level ping is attached during render. If that render is restarted or abandoned, resolving the promise can still revive the suspended lanes.
- A targeted boundary retry is recorded during render but attached only after commit, when the boundary fiber is known to be current.

Fig never trusts a fiber identity captured from unfinished work. A render may restart, reuse a fiber in place, or discard it entirely.

Deletion severs the removed subtree's parent links after cleanup. A late retry or stale setter then fails to find a root and becomes a no-op instead of scheduling phantom work.

Render and commit paths still treat a missing root as an invariant violation. APIs callable after unmount must tolerate it.

## Testing With `act`

While an `act` scope is open, Fig queues scheduler callbacks instead of posting them to the host. The outermost scope waits for the callback, drains work by priority, runs continuations, and repeats across microtask and macrotask turns until Fig has no scheduled work.

This covers renders, effects, updates after awaited code inside the callback, and Suspense retries that ping before `act` finishes. It does not advance arbitrary application timers.
