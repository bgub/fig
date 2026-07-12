# Intro to Fig

Fig is an attempt to imagine what React would look like if it was designed from scratch in 2026.

It starts from a simple premise: React made almost all the right choices. Its model — components, fibers, scheduling, suspense, and streaming — is worth keeping. Fig keeps that model but uses slightly different syntax, adds some features, and removes others. In addition to React, it was heavily inspired by Remix 3 and the TanStack libraries.

## What React got right

- **UI as a declarative function of state.** You describe what the screen should look like for a given state, and you never imperatively mutate the view.
- **Framework-owned updates.** Letting the framework update the view to match state prevents footguns (forgotten DOM updates, stale UI) and improves performance, since it can batch and order the work.
- **A platform-agnostic core.** The component model doesn't know about the DOM, so it can be used in web, CLI, native, desktop — even GPU renderers.
- **Coarse-grained updates instead of signals.** Signals are super cool, but in real-world apps the perf gains from fine-grained reactivity rarely matter, and the model complicates everything else: tooling, server rendering, hydration, concurrent/background rendering. Re-rendering components and diffing is simpler and composes with all of the above. (I'll probably write a full article about this decision elsewhere.)
- **Fiber.** Representing the UI as a tree of small work units means expensive renders can be split up and interrupted, urgent updates can jump the queue, and commits are atomic — the user never sees a half-rendered screen.
- **Streaming SSR with suspense.** The server streams HTML as it's ready, slower content streams in afterward inside suspense boundaries, and selective hydration makes each piece interactive independently.
- **Server components.** People bash on this model, but it's a great idea: run several data-fetching and processing steps inside the component that uses them, all on the server, in one pass (no client round trips), then stream the serialized component to the browser without shipping the code that produced it (the data-fetching code, the markdown renderer, ...).
- **Transitions and Activity.** A transition renders in the background and swaps the result into the tree all at once, so the committed UI stays consistent. Activity keeps hidden UI alive and pre-renders it offscreen. Together they're why well-built React apps feel really, really fast.

## What React got wrong

But React has a few real drawbacks too. Each maps to something Fig fixes below.

- **Bundle size.** A meaningful chunk of it is backwards compatibility: class components, legacy context, synthetic events, ref plumbing.
- **Server components were framework-coupled and confusing.** The wire format was an internal detail, historically unstable and underdocumented, and frameworks like Next.js layered "magic behavior" on top (auto-detecting dynamic boundaries, for example), which made it even more confusing.
- **Confusing terminology.** "Server-side rendering" and "server components" are completely different things that sound like the same thing. `useEffect` vs `useLayoutEffect` says nothing about when either one runs.
- **Synthetic events.** A parallel event system with React-specific names and non-native propagation quirks.
- **Using the platform.** The web grew standard primitives and React's APIs predate them. The platform settled on `AbortSignal` for cancellation, but React effects signal cleanup by returning a closure, so aborting an in-flight fetch means wiring up your own `AbortController` in every effect. Server rendering split into environment-specific entry points (`renderToPipeableStream` for Node, `renderToReadableStream` for the web) instead of one API.
- **Data fetching.** Loading keyed async data is the most common thing apps do, and React never owned it. There's no cache, no invalidation, no server-to-client handoff, so every app bolts on React Query, SWR, or a framework's loader layer, each with its own vocabulary for staleness, mutations, and hydration.
- **Asset loading.** Stylesheets, fonts, and preloads determine when UI is safe to show, but React didn't address them until React 19's hoistables — and then implicitly: render a `<link>` anywhere and hoisting rules dedupe and relocate it for you. Without knowing the rules, it's hard to predict what will happen.

## What Fig does about it

First, what stays: Fig keeps the modern React runtime model wholesale — components, fibers, lanes, scheduling, suspense, streaming, selective hydration. The machinery is the same shape (docs 3 and 4 walk through it). Everything below is the delta.

### Data is built in, not bolted on

`dataResource` defines keyed async values where the key _is_ the identity. No id registry, no React-Query-sized vocabulary:

- `readData` suspends while loading, and errors hit your `ErrorBoundary`
- Freshness is exactly two verbs: `invalidateData` (mark stale) and `refreshData` (load now)
- Mutations, SSR handoff, and hydration all flow through one flat cache
- Loaders receive an `AbortSignal` and a typed app context

### Assets are fine-grained and render-discovered

Explicit creators (`stylesheet`, `preload`, `font`, `preconnect`, ...) produce plain data with deterministic dedupe keys. A stylesheet discovered three different ways renders once. Streamed content waits for its CSS before revealing (no flash of unstyled content), and preloads/preconnects stream near the segment that needs them. This replaces React 19's implicit hoistable magic with data plus one documented mechanism.

### The compat layers go away

- No classes, no legacy context, no synthetic events, and no refs at all — DOM access is `bind`, a normal prop that receives `(node, signal)`
- Redundant APIs are pruned: no `memo` (tiered bailouts preserve child identity, so unchanged siblings bail out automatically), no `useRef`, no `useReducer`
- Shedding the compat layers is what keeps the bundle small — Fig isn't carrying two of everything

### Events are native

Events are declared as descriptors: `events={[on("click", (event, signal) => ...)]}`. The callback receives the real native event, and propagation is native with no exceptions. No wrapper, no pooling, no React-specific event names.

### Names mean what they say

- Native platform names where they're clearer: `class`, `for`, `tabindex`, native event names
- Hooks are named for _when_ they run: `useReactive` (React: `useEffect`), `useBeforePaint` (React: `useLayoutEffect`)
- The server entry points form one `renderTo*` grid instead of a pile of unrelated names
- The server-component wire layer is called "payload" — never "RSC" or "Flight"

### Explicit APIs instead of overloaded magic

React's `use(resource)` is three explicit verbs: `readContext`, `readPromise`, `readData`. There's no auto-detection magic anywhere.

### One cancellation contract

Effects, events, binds, stable events, actions, data loaders, and `useTransition` callbacks all receive an `AbortSignal`, and none of them return a cleanup. Abort _is_ the cleanup. (Top-level `transition()` is the one exception — it has nothing to cancel against.)

### Server components, specified

Fig's server components serialize to payload, Fig's own wire layer: a specified
row model with pluggable codecs. The default JSON codec is readable in
development; the byte format itself is not promised as a stable public format.

### Dev mode is strict and loud

Dev rendering is always strict (there's no toggle), and diagnostics throw before commit instead of warning after.

## What it looks like

```tsx
import { useState } from "@bgub/fig";
import { createRoot, on } from "@bgub/fig-dom";

function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button
      class="counter"
      events={[on("click", () => setCount((c) => c + 1))]}
    >
      clicked {count} times
    </button>
  );
}

createRoot(document.getElementById("root")!).render(<Counter />);
```

If you squint, it's React: `useState`, JSX, a root. The differences you can see (`class`, `events={[on(...)]}`, the package split) are where doc 2 picks up.

## Where to next

- **Doc 2 (quickstart)** — the common differences from React, with code. Start here if you're migrating.
- **Docs 3–4** — the internals: fiber architecture, then async, streaming & hydration.
- **Doc 5** — the data layer in depth.
- **Doc 6** — payload, the server-component wire format.
- **Doc 7** — asset resources: stylesheets, fonts, preloads, and reveal gating.
- **Concepts** (`docs/concepts/`) — the spec: every contract and invariant, one file per subsystem.
