# fiber architecture

## render lifecycle

high-level: `state update -> schedule -> render -> commit`

fig follows almost exactly the same philosophy as react fiber.

- your ui is just a tree. every node has exactly 1 parent and between 0 and arbitrarily many children. when `useState()` is called from a node, fig stores the state on that node in the tree
- when there's a state update (or on first load of the app), we schedule the render step.
- in the render step, we build a "WIP tree" by walking the current tree node-by-node in depth-first search, comparing as we go — this comparison IS the diff. if a node's inputs (props + state + context) haven't changed and nothing below it has work, we reuse the current tree's version of that node wholesale and skip its whole subtree. nodes that DID change get flagged with what needs to happen to the DOM (insert, update, delete)
- if we detect that we've been rendering for more than 5ms, we yield back to the browser (so it can paint + process user input). resuming is cheap because every node carries pointers to its child, sibling, and parent — "where we were" is just the node we were on, and the half-built WIP tree can be picked up (or thrown away entirely) at any time
- finally, when the entire WIP tree is ready, we commit: apply the flagged DOM changes and swap the WIP tree in as the new current tree. unlike rendering, commit is synchronous and never partial — the user never sees a half-updated screen. splitting the work this way (render = figure out what changed, interruptible; commit = apply it, atomic) is the whole trick
- after commit, effects run: layout-timed ones synchronously before the browser paints, `useReactive` ones after paint

## schedule - more details

let's get into the nitty gritty.

each node ("fiber") has a `memoizedState` field which points to the first hook of a linked list: `Hook -> Hook -> Hook -> null` — one hook per hook call site, in call order (this is why hook order must be stable: there are no names, just position in the list).

Each `Hook` (for `useState`) has:

- `memoizedState` — the current state, i.e. what this render pass computed and the screen shows.
- `queue.dispatch` - the setter, i.e. `setCount`
- `queue.pending` — a queue of state updates in dispatch order, each stored as `{ action, lane, next }`
- `baseState` + `baseQueue` — the rebase ledger (explained below)

every call to the setter appends one `{ action, lane }` node to the queue:

- `action` is whatever you passed, stored raw and evaluated at render time: either the next state value or a `prev => next` function. (this is why `setCount(count + 1)` three times gives +1 but `setCount(c => c + 1)` three times gives +3 — values stamp over each other, functions chain)
- `lane` is the priority, stamped per-update at dispatch time. `requestUpdateLane()` takes no arguments — it reads an ambient "current lane" set by whoever is running your code: fig-dom event dispatch sets it by event type (click → sync, scroll → continuous), `transition()` sets a transition lane, nothing → default lane. so one hook's queue can hold updates at several different priorities at once

when a render eventually processes this queue, it only applies updates whose lane is in that render's lane mask — skipped updates aren't lost, they're rebased and replayed in order later. but that's render-step work; details in the next section. the rest of THIS section is the write path: how a stamped update becomes a scheduled render.

### lanes

a lane is one bit in a 31-bit bitmask. lower bit = higher priority. the taxonomy:

- `SyncLane` — discrete events (click, keydown, ...): things where the user expects an immediate response
- `InputContinuousLane` — continuous events (scroll, pointermove, drag): urgent, but fine to coalesce
- `DefaultLane` — updates from code running in no special context (timers, network callbacks)
- `GestureLane` — gesture-driven updates
- 14 `TransitionLane`s — `transition()` updates. multiple bits so overlapping transitions get distinct lanes (claimed round-robin)
- 4 `RetryLane`s — suspense retries (a thrown promise resolved, re-render the boundary)
- `DeferredLane` (`useLaggedValue` re-renders), `OffscreenLane` (updates inside hidden Activity subtrees), `IdleLane`
- plus hydration twins of most of the above (`SyncHydrationLane`, `DefaultHydrationLane`, `SelectiveHydrationLane`, ...)

why bits instead of a priority number? merging is OR, membership is AND, and a _set_ of lanes can render as one mask — all 14 transition lanes render as a group, so overlapping transitions batch into one pass for free.

### from setter to root: `pendingLanes`

appending to the hook queue is only half of what the setter does. it also (`scheduleFiber`):

- marks the lane on the fiber's own `lanes`
- walks up the `return` pointers marking `childLanes` on every ancestor — this is how the render step later knows "something below here has work" (the bailout check from the overview)
- ORs the lane into `root.pendingLanes` and asks the root to schedule a render

the root then decides what to actually render (`getNextLanes`):

1. expired lanes first (see starvation below)
2. otherwise the highest-priority pending lane that isn't suspended (suspended = that lane's render hit an unresolved promise; it's parked until the promise resolves and "pings" it back schedulable — the full story is doc 4)
3. transitions and retries are picked as whole groups, not single lanes

scheduling is idempotent: if a callback is already scheduled at the same priority, a new update just rides along — its bit is already in `pendingLanes`. if HIGHER-priority work arrives, the scheduled callback is cancelled and replaced, and an in-progress lower-priority render gets its half-built WIP tree discarded and restarted. that's interruption, and it's cheap precisely because rendering never touched the DOM.

### the scheduler

quick event-loop recap, because this whole layer is shaped by it: JS is single-threaded, and the browser can only paint and process input BETWEEN tasks. one long task = frozen page. so rendering without jank means splitting work into small macrotasks and handing the thread back constantly. that's the entire design brief.

the scheduler is a small internal module (not a published package) that knows nothing about fibers or lanes — it just runs prioritized callbacks:

- five tiers, mapped down from lanes: sync → Immediate, input/gesture → UserBlocking, default + transitions → Normal, retries → Low, idle/offscreen → Idle
- one min-heap of tasks, sorted by expiration time = now + the tier's timeout (Immediate: −1ms, i.e. born expired; UserBlocking: 250ms; Normal: 5s; Low: 10s; Idle: effectively never)
- work runs in posted macrotasks: `setImmediate` in node, `MessageChannel` in browsers — NOT `setTimeout`, because nested `setTimeout(0)` gets clamped to 4ms+, which would waste most of a frame per hop (`setTimeout` is the last-resort fallback)
- each hop flushes tasks until the 5ms frame budget elapses (or a commit requested a paint), then posts another hop if work remains
- a render that yields mid-tree keeps its WIP tree + position on the root and simply gets rescheduled — the next hop picks up where it left off

### starvation

time-slicing has a failure mode: a steady stream of high-priority work could postpone low-priority work forever. two safety nets, one per layer:

- lane level: pending lanes get expiration times when first seen (sync/input/gesture: 250ms, default/transition: 5s; retries and idle work never expire — they're genuinely background). once expired, a lane goes into `root.expiredLanes` and `getNextLanes` picks it before EVERYTHING else — even newly arriving clicks can't cut in line anymore
- task level: once a task's expiration time passes, the work loop runs it even past the 5ms frame budget

net effect: a transition can be delayed by a stream of clicks, but never indefinitely.

### what "sync" actually means

a `SyncLane` update does NOT render inside your `setState` call — it still schedules a task (Immediate tier, next macrotask hop). "sync" means the render, once started, doesn't time-slice and can't be interrupted. actually-synchronous flushing is what `flushSync` does, and it's the only escape hatch from automatic batching.

## render - more details

the schedule section covered the write path; this is the read path. the scheduled task fires, and we start building the WIP tree. the first thing rendering a component does is process each of its hooks' update queues.

### processing the update queue

the render walks each hook's queue in dispatch order, but only APPLIES updates whose lane bit is in this render's lane mask (one bitwise AND per update). skipped updates aren't dropped — they're rebased, which is what `baseState` + `baseQueue` are for:

- `memoizedState` = what the screen shows now (may have "jumped ahead" past skipped updates)
- `baseState` = where a future replay must restart from: the running state pinned at the FIRST skipped update. everything before the first skip is settled forever and folds into this value
- `baseQueue` = everything from the first skip onward, in original order — including clones of updates that DID apply this render (lane cleared to "always apply"), because they must re-run on top of the skipped ones later to preserve dispatch order

worked example: `count = 1`, queue = [A: transition, `c => c + 10`], [B: click, `c => c * 2`]

- sync render (mask = sync only): A skipped → pin `baseState = 1`, baseQueue = [A]. B applies → screen shows 2. but something before B was skipped, so a clone B' (lane cleared) also goes in → baseQueue = [A, B']
- transition render later: replay from `baseState = 1`: A → 11, B' → 22. final = (1 + 10) × 2, exactly as if they'd run in dispatch order

so high-priority state can jump ahead visually (click feels instant), but every queue eventually replays in dispatch order — fast now, correct later. without the B' clone the final would be 2 + 10 = 12, i.e. reordered.

(implementation detail, only matters when reading source: `queue.pending` is a circular list pointing at the NEWEST node, so append is O(1) and `pending.next` wraps to the oldest)

## commit - more details

commit is one synchronous, never-yielding pass with a strict internal order. the order exists to bracket two moments: "the DOM changes" and "the browser paints". the three effect hooks are named for exactly where they sit relative to those two moments:

`useBeforeLayout → [deletions → mutations → SWAP current] → useBeforePaint → (browser paints) → useReactive`

react analogs (fig's names say WHEN they run, react's don't): `useBeforeLayout` = `useInsertionEffect`, `useBeforePaint` = `useLayoutEffect`, `useReactive` = `useEffect`

### commit executes; render already decided

by the time commit runs, every decision is made: fibers carry flags (insert / update / delete), parents carry deletion lists, and each fiber has an `effects` array holding ONLY the effects whose deps changed — that filtering happened during render, not commit. commit is pure execution: no diffing, no dep comparison.

### the timeline

pre-mutation:

- swap `useStableEvent` handlers (react: `useEffectEvent`) + action instances to the newly-rendered versions — stable identity outside, fresh values inside, and commit is the moment the swap happens
- run `useBeforeLayout` effects — BEFORE any host mutation, even deletions. this is the css-in-js slot: inject style rules before the nodes that need them exist

mutation:

- deletions first. each deleted subtree tears down in order: release its data-store subscriptions → abort everything (every effect's controller, stable-event signals, in-flight transitions/actions) → remove the host nodes. unmount cleanup IS this abort step — fig has no cleanup functions, so unmount = firing abort signals, and they fire while the nodes are still in the DOM
- then the flag walk: placement runs (contiguous new siblings inserted in one run), host prop/text updates, portals. adopted subtrees are skipped entirely — the render bailouts pay off a second time here

the swap:

- `root.current = finishedWork` — MID-commit: after mutations, before layout-timed effects. from this point "the current tree" means the new one. lane bookkeeping happens here too (finished lanes cleared from `pendingLanes`)

post-mutation, still pre-paint (same task — the browser hasn't painted yet):

- `useExternalStore` (react: `useSyncExternalStore`) resubscribes + re-checks snapshots; if a store changed DURING render (tearing), schedule an immediate sync re-render
- run `useBeforePaint` effects — the DOM is fully mutated, so measuring reads real layout, and anything they write still lands before the user sees a frame
- flush error callbacks: `ErrorBoundary` `onError` for errors caught this render, then the root's `onRecoverableError`

deferred:

- `useReactive` effects are collected into a pending list and a normal-priority task is scheduled to flush them. this happens in a `finally`, paired with clearing fiber flags — a throwing commit step can't leave stale flags or lost effects
- last line of commit: `requestPaint()` — the work loop yields at its next check, the browser paints, THEN the reactive task runs

### why useReactive is "after paint"

not rAF — it falls out of the scheduler section: the flush is just a normal-priority task, but `requestPaint()` forces a yield first, the browser paints in the gap, and the next macrotask hop runs the effects. one guarantee on top: if a new render starts before that task fires, pending reactive effects flush FIRST (cancel the task, run them now) — so reactive effects can be delayed past paint, but never past the next render. no render ever observes un-run effects.

### how one effect runs

the AbortSignal contract, mechanically:

1. abort the previous controller — this abort IS the cleanup step. dependency-change cleanup and unmount cleanup are the same mechanism
2. make a fresh `AbortController`
3. call `effect.create(signal)` with the ambient data store set (so `preloadData` / `invalidateData` work synchronously inside effects)
4. dev only: a first-time effect is then aborted and re-run with another fresh signal — the always-strict behavior that flushes out effects ignoring their signal

the `create` call is wrapped in try/catch, so a throwing effect can never kill the commit or a scheduler tick: the error routes to the nearest `ErrorBoundary` (captured + scheduled as a normal re-render), else the root's uncaught-error path.

## dev behavior

dev's job is to make mistakes loud BEFORE they commit: strict double-rendering makes impure renders loud, the double-abort makes ignored abort signals loud, pre-commit diagnostics make invalid trees loud. (we've already brushed against two of these — the shadow pass in render, the strict effect re-run in commit; this section is the consolidated story.)

### always-strict rendering

- there is no `StrictMode` component and no opt-out — dev always strict-renders. it's a stance, not a default: nothing to wrap, nothing to disable
- the shadow pass: every render invokes the component twice, and the FIRST invocation is discarded — its hooks, effects, and consumed update queues are thrown away and restored, and no reconciliation happens on it. only the second invocation commits. purpose: non-idempotent renders (mutating during render, impure component bodies) produce visibly wrong results instead of silently working
- the effect/bind double-run: first-time effects and `bind` callbacks run → abort → run again with a fresh signal, once per hook lifetime. tracked by a `strictRan` flag set BEFORE the first call, so a render nested inside an effect can't re-enter the cycle. purpose: effects that ignore their AbortSignal break visibly in dev instead of leaking in prod
- client-only: server rendering never double-invokes

### pre-commit diagnostics

invalid render input THROWS before commit instead of warning after — the committed tree is never built from input fig considers invalid:

- duplicate sibling keys
- invalid children
- render-phase state updates
- invalid DOM nesting — the rules model actual HTML parser scoping (button/table scope boundaries, li/dd/dt implied end tags; whitespace-only text and hoisted asset tags are exempt), and they run on BOTH sides: the client validates at fiber creation, the server threads an ancestor stack so suspended segments validate against their logical position

### how it all disappears in production

everything above is gated behind inline `process.env.NODE_ENV !== "production"` checks, so bundlers strip it — no dev/prod package split, no runtime flag. even the lane NAME table survives only for tests and diagnostics; production code uses raw mask checks.

(other subsystems ship their own dev diagnostics — the `onChange` → `on("input")` steering warning in events, key/args drift fingerprinting in fig-data, late head-asset warnings in assets — but those belong to their own docs. dev-only tooling seams, for completeness: `fig-reconciler/devtools` for commit snapshots and `fig-reconciler/refresh` for HMR)

---

next: doc 4 — how suspense rides this machinery, on the client (async lifecycle), on the server (streaming), and across the two (hydration).
