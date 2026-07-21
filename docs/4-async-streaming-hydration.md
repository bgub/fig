# Async, streaming & hydration

Doc 2 built the machine — lanes, the work loop, render, and commit — and doc 3 followed a normal update through its lifecycle. This doc is what happens when a component isn't ready: on the client (suspense and transitions), on the server (streaming), and across the two (hydration).

## The async lifecycle

Everything async in Fig rides one trick: `readPromise` and `readData` _throw_ the pending promise. A component that isn't ready doesn't return partial UI — it throws, the render abandons that attempt, and the machinery from doc 2 (lanes, parked work, retries) handles the rest.

### What happens when a render suspends

- The thrown promise propagates out of the render. The WIP attempt is discarded, and the lanes being rendered are marked suspended on the root. The scheduler passes over them, so Fig doesn't busy-loop re-rendering something that can't finish.
- Fig attaches a listener to the promise. When it settles (either way!), it "pings" the root: the suspended lanes go into `pingedLanes` and become schedulable again. The re-render runs, and this time `readPromise` returns the value (or throws the real error).
- Rejection means the error is thrown at the read site on the retry render, so it routes to the nearest `ErrorBoundary` like any render error. One carve-out: an aborted run's rejection is swallowed — cancellation is not an error in Fig.

### Suspense boundaries

- The nearest `Suspense` boundary above the suspension catches it: the primary content is set aside and the fallback is committed. Retries schedule on `RetryLane`s — low priority, excluded from expiration, genuinely background.
- Re-suspension after content already showed: the committed primary is kept hidden, not destroyed. State, effect instances, and DOM survive under the fallback and come back on reveal.
- State updates targeting content inside a hidden or suspended subtree get demoted to `OffscreenLane` (see doc 2's lane section), so background trees can't preempt visible work.

### Transitions + suspense

This is why transitions exist. Suppose doc 2's `ExpensiveChart` had also read data that wasn't cached yet: a transition render that suspends doesn't yank the current screen. The transition lanes just park (suspended), the committed tree stays up and interactive, `isPending` stays true, and the ping restarts the background render when data arrives. The user sees old screen → new screen, never old screen → fallback → new screen.

### Cancellation

`useTransition` callbacks and actions receive an `AbortSignal`, aborted on supersede, unmount, and Activity hide — each hook is one cancellation domain. An aborted run is retired: its pending slot releases immediately, its rejection is swallowed (an aborted fetch rejecting is the happy path), and for actions its result can never clobber newer state — last run wins. Aborting is a signal, not an unwind: state the callback already set stays committed.

## The server lifecycle

The server has no fibers, no lanes, no commit — none of it is needed, because there's no state to update and nothing to prioritize. Rendering is a recursive walk over "frames" that write HTML into "segments" (chunk buffers), top to bottom, as fast as data allows.

### Suspending on the server

Same trick, different machinery: `readPromise` and `readData` throw the pending thenable, and the renderer catches it at the child list. If there's an enclosing `Suspense` boundary:

- a placeholder segment is created at the current output position
- a task is spawned for the suspended child at its original index, and later siblings keep rendering so their data starts in the same pass
- `.then(ping)` is attached to the thenable, and rendering moves on with the rest of the tree

When the promise settles, the ping queues the task; a microtask drains all pinged tasks in one pass. A `pendingTasks` counter ticks down to zero, and `allReady` resolves. If there's no boundary above the suspension, the thenable propagates up and the shell waits — a slow read outside any `Suspense` delays time-to-first-byte, which is the lever `Suspense` placement gives you.

### What's actually on the wire

Pure HTML, plus a tiny inline runtime that relocates it. Three stages:

1. First flush: an unsettled boundary emits its fallback, bracketed by markers — `<!--fig:suspense:pending:4--><template id="b-4"></template>` fallback `<!--/fig:suspense-->`. The comment carries state; the `<template>` is the id-addressable slot.
2. Content settles later: the server appends (end of stream, out of order) a hidden staging segment of plain rendered HTML plus a one-line op — `<div hidden id="s-4">…content…</div><script>(__figSSR=>{__figSSR.c("b-4","s-4")})(globalThis["__figSSR_1"])</script>`. `__figSSR` is the wrapper-local alias for the request's uniquely named global runtime object (the actual suffix varies by request). The op moves the staged children into the slot, deletes the fallback, rewrites the marker to `completed`, and pings the hydration retry hook if one is attached. The swap costs a DOM move, not a re-render, and it works before any framework JS loads — streamed content appears without hydration.
3. The runtime object itself is written lazily, once, inline, nonce-compatible. The op set: `c` completes a boundary, `s` fills a partial segment, `x(boundary, digest, message)` marks a boundary client-rendered (how server errors reach the DOM), `r` delays a completion until its stylesheets load (no flash of unstyled content), `ac`/`ax` are the hidden-Activity variants.

Fast path: a boundary that settles before its parent flushes skips all of it and inlines in place — `<!--fig:suspense:completed-->content<!--/fig:suspense-->`. No template, no segment, no script.

### The entry grid

`render + To + (Document?) + output form`: `renderToStream` / `renderToDocumentStream` / `renderToHtml` / `renderToDocumentHtml`. Streams are web `ReadableStream`s; results return synchronously as `{ stream, shellReady, headReady?, allReady, ... }` — no shell-gated promise, and a shell failure rejects `shellReady` (the one channel for that event). `renderToHtml` is honestly "the streamed output, buffered": it awaits `allReady` and concatenates exactly the bytes a streaming client would have received, inline runtime included. It is not React's `renderToString`.

`prerender` is the separate static semantic: hold every flush until `pendingTasks` hits zero, so every boundary takes the inline fast path — completed content in logical position, no runtime ever written. That's the SSG primitive, and it also seals the head late (head assets discovered inside suspended content still land).

### Errors

Server render errors cross the wire only through `onError(error, info) => { digest?, message? }` — production defaults to empty, dev includes the message. A failed boundary becomes the `x` op (or its static equivalent in prerender): the marker is rewritten to `client`, the digest and message are stashed on the placeholder, and the client re-renders that boundary locally.

### Not to be confused with payload

This HTML+ops protocol carries rendered UI; its consumer is the browser's HTML parser plus the inline runtime. Payload (`@bgub/fig-server/payload` on the server, `@bgub/fig/payload` in the browser) is the server-component wire layer: row-encoded element trees consumed by Fig's client runtime, with JSON as the default codec. Both stream, both handle suspense, different layers. (Payload is doc 6.)

## The hydration lifecycle

Hydration is the client render adopting the server's DOM instead of creating nodes: `hydrateRoot` walks the tree and claims existing host nodes as it goes.

### Dehydrated boundaries are first-class

fig-dom parses the streaming markers (`<!--fig:suspense:...-->`) into `DehydratedSuspenseBoundary` objects — marker knowledge lives in the renderer package, behind hydration host hooks. A dehydrated boundary commits _as_ a fiber without touching its server DOM: the tree around it is live and interactive while the boundary hydrates later, at its own priority. Streaming and hydration overlap freely — segments can still be arriving while hydration proceeds, and a boundary whose content completes gets its retry scheduled (the `c` op pings the retry hook the client attached).

### Selective hydration

Hydration is suspense-boundary selective, and interaction upgrades priority: per-root capture-phase listeners watch for input targeting dehydrated content, and hydrate that boundary at input priority. `SelectiveHydrationLane` schedules at Normal — event-triggered hydration is real work, not idle work, or it would starve behind every transition.

### Event replay

Replayable events (click, key, pointer) that land on a still-dehydrated boundary aren't dropped. They queue, and after the boundary hydrates they replay as a synthetic two-phase dispatch through the logical tree (portals included, same as live delegation). So a click on server-rendered content works even if it arrived before the code did.

### Suspending during hydration

A dehydrated boundary whose hydration attempt suspends stays dehydrated: the server DOM is preserved and the thenable ping retries hydration. No fallback is ever rendered over server content — the user never watches good server HTML get replaced by a spinner.

### Mismatches

- Server-only attributes and styles are preserved (browser extensions and edge-injected markers survive), with a dev warning when they diverge from the client render.
- Text mismatches recover with a root client render, reported through `onRecoverableError` (digest included).
- Host elements support React's `suppressHydrationWarning` prop as a one-level escape hatch for intentional text/attribute divergence. It does not suppress structural mismatches. Request-known shell state like cookie-backed color scheme belongs in the framework document shell; the broader legitimate mismatch class (time, locale, viewport) is still being designed as a hydration-stable environment snapshot — capture on the server, hydrate against the same snapshot, go live after. (Still exploring; see `docs/concepts/hydration.md`.)

---

Next: doc 5 — the data layer in depth: resources, the cache, freshness, and the server-to-client handoff.
