# async, streaming & hydration

doc 3 built the machine: lanes, the work loop, render, commit. this doc is what happens when a component ISN'T READY — on the client (suspense + transitions), on the server (streaming), and across the two (hydration).

## async lifecycle

everything async in fig rides one trick: `readPromise` / `readData` THROW the pending promise. a component that isn't ready doesn't return partial UI — it throws, the render abandons that attempt, and the machinery from doc 3 (lanes, parked work, retries) handles the rest.

### what happens when a render suspends

- the thrown promise propagates out of the render. the WIP attempt is discarded, and the lanes being rendered are marked SUSPENDED on the root — this is the `suspendedLanes` from doc 3's schedule section: `getNextLanes` skips them, so fig doesn't busy-loop re-rendering something that can't finish
- fig attaches a listener to the promise. when it settles (either way!), it "pings" the root: the suspended lanes go into `pingedLanes` and become schedulable again → re-render → this time `readPromise` returns the value (or throws the real error)
- rejection = the error is thrown at the read site on the retry render, so it routes to the nearest `ErrorBoundary` like any render error. one carve-out: an ABORTED run's rejection is swallowed — cancellation is not an error in fig

### suspense boundaries

- the nearest `Suspense` boundary above the suspension catches it: the primary content is set aside and the fallback is committed. retries schedule on `RetryLane`s — low priority, excluded from expiration (genuinely background)
- re-suspension after content already showed: the committed primary is kept HIDDEN, not destroyed — state, effects instances, and DOM survive under the fallback and come back on reveal
- state updates targeting content inside a hidden/suspended subtree get demoted to `OffscreenLane` (the `hiddenSubtreeLane` routing from doc 3) so background trees can't preempt visible work

### transitions + suspense

this is why transitions exist: a transition render that suspends doesn't yank the current screen. the transition lanes just park (suspended), the committed tree stays up and interactive, `isPending` stays true, and the ping restarts the background render when data arrives. the user sees old-screen → new-screen, never old-screen → fallback → new-screen.

### cancellation

`useTransition` callbacks and actions receive an `AbortSignal` (aborted on supersede, unmount, and Activity hide — each hook is one cancellation domain). an aborted run is RETIRED: its pending slot releases immediately, its rejection is swallowed (an aborted fetch rejecting is the happy path), and for actions its result can never clobber newer state — last-run-wins. aborting is a signal, not an unwind: state the callback already set stays committed.

## server lifecycle

the server has no fibers, no lanes, no commit — none of it is needed, because there's no state to update and nothing to prioritize. rendering is a recursive walk over "frames" that write HTML into "segments" (chunk buffers), top to bottom, as fast as data allows.

### suspending on the server

same trick, different machinery: `readPromise` / `readData` throw the pending thenable, and the renderer catches it at the child list. if there's an enclosing `Suspense` boundary:

- a placeholder segment is created at the current output position
- a TASK is spawned holding the unrendered children from the suspension point onward (already-rendered older siblings aren't redone)
- `.then(ping)` is attached to the thenable, and rendering moves on with the rest of the tree

when the promise settles, the ping queues the task; a microtask drains all pinged tasks in one pass. a `pendingTasks` counter ticks down to zero → `allReady` resolves. no boundary above the suspension → the thenable propagates up and the SHELL waits — a slow read outside any `Suspense` delays time-to-first-byte, which is exactly the lever `Suspense` placement gives you.

### what's actually on the wire

pure HTML, plus a tiny inline runtime that relocates it. three stages:

1. first flush — an unsettled boundary emits its FALLBACK, bracketed by markers: `<!--fig:suspense:pending:4--><template id="b-4"></template>` fallback `<!--/fig:suspense-->`. the comment carries state; the `<template>` is the id-addressable slot
2. content settles later — the server appends (end of stream, out of order) a hidden staging segment of plain rendered HTML plus a one-line op: `<div hidden id="s-4">…content…</div><script>$F.c("b-4","s-4")</script>`. the op moves the staged children into the slot, deletes the fallback, rewrites the marker to `completed`, and pings the hydration retry hook if one is attached. the swap costs a DOM move, not a re-render — and it works BEFORE any framework JS loads; streamed content appears without hydration
3. the runtime object itself is written lazily, once, inline, nonce-compatible. the op set: `c` complete a boundary, `s` fill a partial segment, `x(boundary, digest, message)` mark a boundary client-rendered (how server errors reach the DOM), `r` delay a completion until its stylesheets load (no flash of unstyled content), `ac`/`ax` the hidden-Activity variants

fast path: a boundary that settles BEFORE its parent flushes skips all of it and inlines in place — `<!--fig:suspense:completed-->content<!--/fig:suspense-->`. no template, no segment, no script.

### the entry grid

`render + To + (Document?) + output form`: `renderToStream` / `renderToDocumentStream` / `renderToHtml` / `renderToDocumentHtml`. streams are web `ReadableStream`s; results return SYNCHRONOUSLY as `{ stream, shellReady, headReady?, allReady, ... }` — no shell-gated promise, and a shell failure rejects `shellReady` (the one channel for that event). `renderToHtml` is honestly "the streamed output, buffered" — it awaits `allReady` and concatenates exactly the bytes a streaming client would have received, inline runtime included. it is NOT react's `renderToString`.

`prerender` is the separate static semantic: hold every flush until `pendingTasks` hits zero, so EVERY boundary takes the inline fast path — completed content in logical position, no runtime ever written. that's the SSG primitive, and it also seals the head late (head assets discovered inside suspended content still land).

### errors

server render errors cross the wire ONLY through `onError(error, info) => { digest?, message? }` — production defaults to empty, dev includes the message. a failed boundary becomes the `x` op (or its static equivalent in prerender): marker rewritten to `client`, digest/message stashed on the placeholder, and the client re-renders that boundary locally.

### not to be confused with payload

this HTML+ops protocol carries RENDERED UI; its consumer is the browser's HTML parser + the inline runtime. payload (`@bgub/fig-server/payload`) is the server-COMPONENT wire format — newline-delimited JSON rows carrying element trees, consumed by fig's client runtime. both stream, both handle suspense, different layers. (payload gets its own doc.)

## hydration lifecycle

hydration is the client render adopting the server's DOM instead of creating nodes: `hydrateRoot` walks the tree and claims existing host nodes as it goes.

### dehydrated boundaries are first-class

fig-dom parses the streaming markers (`<!--fig:suspense:...-->`) into `DehydratedSuspenseBoundary` objects — marker knowledge lives in the renderer package, behind hydration host hooks. a dehydrated boundary commits AS a fiber without touching its server DOM: the tree around it is live and interactive while the boundary hydrates later, at its own priority (the hydration-twin lanes from doc 3's taxonomy). streaming and hydration overlap freely — segments can still be arriving while hydration proceeds; a boundary whose content completes gets its retry scheduled (the `c` op pings the retry hook the client attached).

### selective hydration

hydration is suspense-boundary selective, and interaction upgrades priority: per-root capture-phase listeners watch for input targeting dehydrated content, and hydrate that boundary at input priority. `SelectiveHydrationLane` schedules at Normal — event-triggered hydration is real work, not idle work, or it would starve behind every transition.

### event replay

replayable events (click, key, pointer) that land on a still-dehydrated boundary aren't dropped — they queue, and after the boundary hydrates they replay as a synthetic two-phase dispatch through the LOGICAL tree (portals included, same as live delegation). so a click on server-rendered content "works" even if it arrived before the code did.

### suspending during hydration

a dehydrated boundary whose hydration attempt suspends STAYS dehydrated: the server DOM is preserved and the thenable ping retries hydration. no fallback is ever rendered over server content — the user never watches good server HTML get replaced by a spinner.

### mismatches

- server-only attributes and styles are PRESERVED (browser extensions and edge-injected markers survive), with a dev warning when they diverge from the client render
- text mismatches recover with a root client render, reported through `onRecoverableError` (digest included)
- there is deliberately NO `suppressHydrationWarning` clone. the legitimate mismatch class (time, locale, viewport, color scheme) is being designed as a hydration-stable environment snapshot instead — capture on the server, hydrate against the same snapshot, go live after (still exploring; see concepts/hydration.md)
