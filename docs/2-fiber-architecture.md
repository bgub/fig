# Fiber architecture

Doc 1 claimed Fig keeps React's runtime model: components, fibers, lanes, scheduling. This doc is that machine in detail. Instead of cataloging the parts, it follows one update through the whole pipeline, introducing each mechanism at the moment the story needs it.

## The scenario

```tsx
import { useState, transition } from "@bgub/fig";
import { on } from "@bgub/fig-dom";

function Counter() {
  const [count, setCount] = useState(1);
  return (
    <>
      <button events={[on("click", () => setCount((c) => c * 2))]}>
        double
      </button>
      <button
        events={[on("click", () => transition(() => setCount((c) => c + 10)))]}
      >
        add ten
      </button>
      <ExpensiveChart count={count} />
    </>
  );
}
```

`ExpensiveChart` is slow to render. The user clicks "add ten", and while Fig is rendering that update in the background, they click "double".

Here's what the user sees: the screen shows 2 immediately, then settles at 22 a moment later. Not 12 — even though the ×2 rendered first, the final state is `(1 + 10) × 2`, as if the updates had run in the order they were dispatched. The rest of this doc is everything Fig does to make both of those things true: the instant 2 and the correct 22.

The pipeline, which is also the map of this doc:

```
setCount(...)                    (the write path)
  stamp a lane on the update
  append it to the hook's queue
  mark lanes up the tree, schedule on the root
        ↓
scheduler picks a lane set       (the scheduler)
        ↓
render                           (the render path)
  build the WIP tree: diff, bail out, time-slice
  process hook queues: skip + rebase by lane
        ↓
commit                           (commit)
  mutate the DOM, swap trees, run effects
```

One framing note before the details: render and commit are split on purpose. Render figures out what changed — it's interruptible, abandonable, and never touches the DOM. Commit applies the changes — synchronous, atomic, never partial. The user never sees a half-updated screen, and Fig can throw away a half-finished render at any time. That split is the whole trick; everything else in this doc is machinery serving it.

## The write path

### The hook and its queue

Every node in the tree (a "fiber") has a `memoizedState` field pointing at the first hook of a linked list: `Hook → Hook → Hook → null`, one per hook call site, in call order. That's why hook order must be stable: there are no names, just positions in the list.

The `Hook` for our `useState(1)` holds:

- `memoizedState` — the current state, i.e. what the last render computed and the screen shows
- `queue.dispatch` — the setter, i.e. `setCount`
- `queue.pending` — a queue of state updates in dispatch order, each stored as `{ action, lane, next }`
- `baseState` + `baseQueue` — the rebase ledger (it earns its keep in the render path)

Every setter call appends one `{ action, lane }` node:

- `action` is whatever you passed, stored raw and evaluated at render time: either a next value or a `prev => next` function. This is why `setCount(count + 1)` three times gives +1 but `setCount(c => c + 1)` three times gives +3 — values stamp over each other, functions chain.
- `lane` is the priority, stamped per-update at dispatch time.

After our two clicks, the queue holds `[A: transition, c => c + 10]`, `[B: sync, c => c * 2]`. One hook, two priorities.

### Where the lane comes from

`requestUpdateLane()` takes no arguments. It reads an ambient "current lane" set by whoever is running your code: fig-dom's event dispatch sets it by event type (click → sync, scroll → continuous), `transition()` sets a transition lane, and code running in no special context gets the default lane. Update A was dispatched inside `transition()`, so it carries a transition lane; update B came straight from a click handler, so it carries the sync lane.

A lane is one bit in a 31-bit bitmask; a lower bit means higher priority. The taxonomy:

| Lane | What lands there |
| --- | --- |
| `SyncLane` | discrete events (click, keydown, ...) — the user expects an immediate response |
| `InputContinuousLane` | continuous events (scroll, pointermove, drag) — urgent, but fine to coalesce |
| `GestureLane` | gesture-driven updates |
| `DefaultLane` | code running in no special context (timers, network callbacks) |
| `TransitionLane` ×10 | `transition()` updates; overlapping transitions claim distinct lanes round-robin |
| transition-deferred ×4 | reserved transition-shaped follow-up lanes; not claimed by `transition()` |
| `RetryLane` ×4 | suspense retries (a thrown promise resolved, re-render the boundary) |
| `DeferredLane` | `useDeferredValue` re-renders |
| `OffscreenLane` | updates inside hidden Activity subtrees |
| `IdleLane` | idle work |

Most of these also have hydration twins (`SyncHydrationLane`, `DefaultHydrationLane`, `SelectiveHydrationLane`, ...); those matter in doc 4.

Why bits instead of a priority number? Merging is OR, membership is AND, and a _set_ of lanes can render as one mask — the ten claimable transition lanes and four reserved transition-deferred lanes form one render group, so overlapping transitions batch into one pass for free.

### From setter to root

Appending to the hook queue is only half of what the setter does. It also (`scheduleFiber`):

- marks the lane on the fiber's own `lanes`
- walks up the `return` pointers marking `childLanes` on every ancestor — this is how a later render knows "something below here has work" without visiting it
- ORs the lane into `root.pendingLanes` and asks the root to schedule a render

Both of our clicks did all three. The interesting part is what the root does with two pending priorities at once.

## The scheduler

### Picking what to render

`getNextLanes` decides what the next render works on:

1. expired lanes first (see starvation, below)
2. otherwise the highest-priority pending lane that isn't suspended — suspended meaning that lane's render hit an unresolved promise and is parked until the promise resolves and "pings" it back schedulable (doc 4's territory)
3. transitions and retries are picked as whole groups, not single lanes

Scheduling is idempotent. If a callback is already scheduled at the same priority, a new update just rides along — its bit is already in `pendingLanes`. If higher-priority work arrives, the scheduled callback is cancelled and replaced, and an in-progress lower-priority render has its half-built WIP tree discarded.

That last case is our scenario. When "double" lands, the transition render for A is mid-flight through `ExpensiveChart`. Its WIP tree is thrown away and a sync-priority task takes its place. This is interruption, and it's cheap precisely because rendering never touched the DOM — there's nothing to undo.

### The task layer

Quick event-loop recap, because this whole layer is shaped by it: JS is single-threaded, and the browser can only paint and process input between tasks. One long task means a frozen page, so rendering without jank means splitting work into small macrotasks and handing the thread back constantly.

The scheduler itself is a small internal module (not a published package) that knows nothing about fibers or lanes — it just runs prioritized callbacks. Lanes map down to five tiers:

| Tier         | Lanes                     | Timeout             |
| ------------ | ------------------------- | ------------------- |
| Immediate    | sync                      | −1ms (born expired) |
| UserBlocking | input, gesture            | 250ms               |
| Normal       | default, transitions      | 5s                  |
| Low          | retries                   | 10s                 |
| Idle         | idle, offscreen, deferred | effectively never   |

- One min-heap of tasks, sorted by expiration time (now + the tier's timeout).
- Work runs in posted macrotasks: `setImmediate` in Node, `MessageChannel` in browsers. Not `setTimeout` — nested `setTimeout(0)` gets clamped to 4ms+, which would waste most of a frame per hop. (`setTimeout` is the last-resort fallback.)
- Each hop flushes tasks until a 5ms frame budget elapses (or a commit requested a paint), then posts another hop if work remains.
- A render that yields mid-tree keeps its WIP tree and position on the root and simply gets rescheduled; the next hop picks up where it left off. Resuming is cheap because every fiber carries pointers to its child, sibling, and parent — "where we were" is just the node we were on.

### Starvation

Time-slicing has a failure mode: a steady stream of high-priority work could postpone low-priority work forever. Suppose the user keeps clicking "double" — when does the transition ever get to render? Two safety nets, one per layer:

- Lane level: pending lanes get expiration times when first seen (sync/input/gesture: 250ms, default/transition: 5s; retries and idle work never expire — they're genuinely background). Once expired, a lane goes into `root.expiredLanes` and `getNextLanes` picks it before everything else; even newly arriving clicks can't cut in line anymore.
- Task level: once a task's expiration time passes, the work loop runs it even past the 5ms frame budget.

Net effect: our transition can be delayed by a stream of clicks, but never indefinitely.

### What "sync" actually means

A `SyncLane` update does not render inside your `setCount` call — it still schedules a task (Immediate tier, next macrotask hop). "Sync" means the render, once started, doesn't time-slice and can't be interrupted. Actually-synchronous flushing is what `flushSync` does, and it's the only escape hatch from automatic batching.

## The render path

The sync task fires, and Fig starts building the WIP tree: walk the current tree depth-first, re-rendering components and comparing new children against old as it goes — this comparison _is_ the diff. If a node's inputs (props + state + context) haven't changed and its `childLanes` say nothing below has work, Fig reuses the current tree's node wholesale and skips the whole subtree. Nodes that changed get flagged with what has to happen to the DOM: insert, update, delete.

The interesting work in our scenario happens when the render reaches our `useState` hook and processes its queue.

### Processing the update queue

The render walks the hook's queue in dispatch order, but only applies updates whose lane bit is in this render's lane mask (one bitwise AND per update). Skipped updates aren't dropped — they're rebased, which is what `baseState` and `baseQueue` are for:

- `memoizedState` — what the screen shows now; it may have "jumped ahead" past skipped updates
- `baseState` — where a future replay must restart from: the running state pinned at the first skipped update. Everything before the first skip is settled forever and folds into this value.
- `baseQueue` — everything from the first skip onward, in original order, including clones of updates that _did_ apply this render (with their lane cleared to "always apply"), because they must re-run on top of the skipped ones later to preserve dispatch order

Walk it with our queue — `count = 1`, `[A: transition, c => c + 10]`, `[B: sync, c => c * 2]`:

- The sync render's mask contains only the sync lane. A is skipped: pin `baseState = 1`, `baseQueue = [A]`. B applies: `memoizedState = 2`. But something before B was skipped, so a clone B′ with its lane cleared goes in too: `baseQueue = [A, B′]`.
- The component renders with `count = 2`, and commit puts 2 on screen (next section).
- The transition render later replays from `baseState = 1`: A gives 11, B′ gives 22. Final state: `(1 + 10) × 2`, exactly as if the updates had run in dispatch order.

Without the B′ clone, the replay would run A on top of the already-shown 2 and land on `2 + 10 = 12` — the updates would have effectively reordered. With it, high-priority state can jump ahead visually (the click feels instant) while every queue still replays in dispatch order.

In the source: `queue.pending` is a circular list pointing at the newest node, so append is O(1) and `pending.next` wraps around to the oldest.

## Commit

The sync render finishes its WIP tree; now Fig has to put 2 on screen. Commit is one synchronous, never-yielding pass with a strict internal order. The order exists to bracket two moments — "the DOM changes" and "the browser paints" — and the three effect hooks are named for where they sit relative to those moments:

`useBeforeLayout → [deletions → mutations → swap current] → useBeforePaint → (browser paints) → useReactive`

React analogs: `useBeforeLayout` = `useInsertionEffect`, `useBeforePaint` = `useLayoutEffect`, `useReactive` = `useEffect`.

### Render decided; commit executes

By the time commit runs, every decision is made: fibers carry flags (insert / update / delete), parents carry deletion lists, and each fiber has an `effects` array holding only the effects whose deps changed — that filtering happened during render, not commit. Commit is pure execution: no diffing, no dep comparison.

### The timeline

Pre-mutation:

- Swap `useStableEvent` handlers (React: `useEffectEvent`) and action instances to the newly-rendered versions. Stable identity outside, fresh values inside, and commit is the moment the swap happens.
- Run `useBeforeLayout` effects, before any host mutation — even deletions. This is the CSS-in-JS slot: inject style rules before the nodes that need them exist.

Mutation:

- Deletions first. Each deleted subtree tears down in order: release its data-store subscriptions → abort everything (every effect's controller, stable-event signals, in-flight transitions and actions) → remove the host nodes. Unmount cleanup _is_ this abort step — Fig has no cleanup functions, so unmount means firing abort signals, and they fire while the nodes are still in the DOM.
- Then the flag walk: placements run (contiguous new siblings inserted in one pass), host prop/text updates, portals. Adopted subtrees are skipped entirely — the render bailouts pay off a second time here.

The swap:

- `root.current = finishedWork`, mid-commit: after mutations, before layout-timed effects. From this point "the current tree" means the new one. Lane bookkeeping happens here too — finished lanes are cleared from `pendingLanes`. (In our scenario the sync bit clears; the transition bit is still there, waiting.)

Post-mutation, still pre-paint (same task — the browser hasn't painted yet):

- `useSyncExternalStore` resubscribes and re-checks snapshots; if a store changed during render (tearing), an immediate sync re-render is scheduled.
- `useBeforePaint` effects run. The DOM is fully mutated, so measuring reads real layout, and anything they write still lands before the user sees a frame.
- Error callbacks flush: `ErrorBoundary` `onError` for errors caught this render, then the root's `onRecoverableError`.

Deferred:

- `useReactive` effects are collected into a pending list, and a normal-priority task is scheduled to flush them. This happens in a `finally`, paired with clearing fiber flags, so a throwing commit step can't leave stale flags or lost effects.
- The last line of commit is `requestPaint()`: the work loop yields at its next check, the browser paints, and then the reactive task runs.

### Why useReactive is "after paint"

Not rAF — it falls out of the task layer. The flush is just a normal-priority task, but `requestPaint()` forces a yield first, and the browser paints in the gap before the next macrotask hop runs the effects. One guarantee on top: if a new render starts before that task fires, pending reactive effects flush first (the task is cancelled and they run immediately). So reactive effects can be delayed past paint, but never past the next render — no render ever observes un-run effects.

### How one effect runs

The AbortSignal contract, mechanically:

1. Abort the previous controller. This abort _is_ the cleanup step — dependency-change cleanup and unmount cleanup are the same mechanism.
2. Make a fresh `AbortController`.
3. Call `effect.create(signal)` with the ambient data store set (so `preloadData` / `invalidateData` work synchronously inside effects).
4. Dev only: a first-time effect is then aborted and re-run with another fresh signal — the always-strict behavior that flushes out effects ignoring their signal.

The `create` call is wrapped in try/catch, so a throwing effect can never kill the commit or a scheduler tick: the error routes to the nearest `ErrorBoundary` (captured and scheduled as a normal re-render), or else to the root's uncaught-error path.

## The replay

The user is looking at 2, and `pendingLanes` still holds the transition bit. The scheduler comes back around at Normal priority and the render path runs again — this time the mask includes the transition lane, so the queue replays from `baseState = 1`: A gives 11, B′ gives 22. `ExpensiveChart` renders with 22, time-sliced now that nothing urgent is competing, and a second commit puts it on screen.

That closes the loop from the top of the doc: the instant 2 is sync work jumping the queue and skipping what it can't afford to wait for; the correct 22 is the skipped work rebasing and replaying in dispatch order. (If the transition render had suspended on data instead of finishing, that's doc 4.)

## Dev behavior

Dev's job is to make mistakes loud before they commit: strict double-rendering makes impure renders loud, the double-abort makes ignored abort signals loud, and pre-commit diagnostics make invalid trees loud. (The effect double-run already appeared in the commit section; this is the consolidated story.)

### Always-strict rendering

- There is no `StrictMode` component and no opt-out — dev always strict-renders. It's a stance, not a default: nothing to wrap, nothing to disable.
- The shadow pass: every render invokes the component twice, and the first invocation is discarded — its hooks, effects, and consumed update queues are thrown away and restored, and no reconciliation happens on it. Only the second invocation commits. Purpose: non-idempotent renders (mutating during render, impure component bodies) produce visibly wrong results instead of silently working.
- The effect/bind double-run: first-time effects and `bind` callbacks run → abort → run again with a fresh signal, once per hook lifetime. Tracked by a `strictRan` flag set before the first call, so a render nested inside an effect can't re-enter the cycle. Purpose: effects that ignore their AbortSignal break visibly in dev instead of leaking in prod.
- Client-only: server rendering never double-invokes.

### Pre-commit diagnostics

Invalid render input throws before commit instead of warning after — the committed tree is never built from input Fig considers invalid:

- duplicate sibling keys
- invalid children
- render-phase state updates
- invalid DOM nesting — the rules model actual HTML parser scoping (button/table scope boundaries, li/dd/dt implied end tags; whitespace-only text and hoisted asset tags are exempt), and they run on both sides: the client validates at fiber creation, and the server threads an ancestor stack so suspended segments validate against their logical position

### How it all disappears in production

Everything above is gated behind inline `__FIG_DEV__` checks, so Fig library builds strip it — no dev/prod package split, no runtime flag. Even the lane name table survives only for tests and diagnostics; production code uses raw mask checks.

(Other subsystems ship their own dev diagnostics — the `onChange` → `on("input")` steering warning in events, key/args drift fingerprinting in the data layer, late head-asset reports in assets — but those belong to their own docs. Dev-only tooling seams, for completeness: `@bgub/fig-reconciler/devtools` for commit snapshots and `@bgub/fig-reconciler/refresh` for HMR.)

---

Next: doc 4 — how suspense rides this machinery, on the client (async lifecycle), on the server (streaming), and across the two (hydration).
