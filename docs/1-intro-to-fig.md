fig is an attempt to imagine what react would look like if it was designed from scratch in 2026.

it starts from a simple premise: react made almost all the right choices

- defining UI as a declarative function of state is intuitive
- letting the framework handle updating the view to match state prevents footguns, improves performance
- react is platform-agnostic, so it works great for not only web but also CLI, native, desktop, even GPU
- signals are super cool, but in real world apps the perf gains from fine-grained reactivity rarely matter, and it complicates everything else: tooling, server rendering, hydration, concurrent/background rendering (compress here; full argument belongs in a "why not signals" aside/FAQ)
- react fiber makes it possible to split up expensive renders, prioritize urgent work, avoid blocking commits, and avoid showing partially rendered UI
- server-side rendering lets you stream server-rendered content to users; suspense lets slower things stream in after, and selective hydration makes them interactive independently
- server components (though people bash on this kind of model) let you perform multiple data-fetching + processing functions within the component that they're used in, all on the server so you don't have multiple round trips, and then stream the serialized component to the user without having to send over the JS (i.e. the data-fetching code or the markdown rendering code etc.)
- react transitions let react perform a render in the background and then swap the rendered stuff into the tree all at once, and Activity keeps hidden UI alive and pre-renders it offscreen — the committed UI stays consistent and websites feel really really fast

BUT, react has a few drawbacks too (each one should map to something fig fixes below)

- somewhat large bundle size, in part due to backwards compatibility concerns
- RSCs were framework-coupled, confusing, and historically unstable / underdocumented — and frameworks like next.js layered "magic behavior" on top (e.g. auto-detecting dynamic boundaries), which made it even more confusing
- somewhat confusing terminology (e.g. server side rendering vs server components are completely different; useEffect vs useLayoutEffect names say nothing about when they run)
- synthetic events: a parallel event system with react-specific names and non-native propagation quirks
- data fetching and asset loading were never really react's job: every app re-solves caching/invalidation with react-query or a framework, and asset handling (hoistables) arrived late as implicit magic

broad overview of fig (roughly in answer to the drawbacks):

- keeps the modern react runtime model: components, fibers, lanes, scheduling, suspense, streaming, selective hydration
- data is built in, not bolted on: `dataResource` defines keyed async values where the key IS the identity — so reads (`readData` suspends, errors hit your ErrorBoundary), mutations, SSR handoff, and hydration all flow through one flat cache with no id registry and no react-query-sized vocabulary (exactly two freshness verbs: `invalidateData`, `refreshData`); loaders get an AbortSignal + typed app context
- assets are fine-grained and render-discovered: explicit creators (`stylesheet`, `preload`, `font`, `preconnect`, ...) produce plain data with deterministic dedupe keys — a stylesheet discovered three ways renders once, streamed content waits for its CSS before revealing (no flash of unstyled content), and preloads/preconnects stream near the segment that needs them; this replaces react 19's implicit hoistable magic with data + one documented mechanism
- drops the legacy compatibility stuff: no classes, no refs at all (DOM access is `bind`), no legacy context, no synthetic events — shedding the compat layers is what keeps the bundle small
- prunes redundant APIs: no `memo` (tiered bailouts preserve child identity so siblings bail automatically), no `useRef`, no `useReducer`
- events are native: declared as `events={[on("click", (event, signal) => ...)]}`, callbacks receive the real native event, propagation is native with no exceptions
- uses native platform names where they're clearer: `class`, `for`, `tabindex`, native event names, etc.
- names things for what they do: `useReactive` / `useBeforePaint` are named for when they run, the server entry points form one `renderTo*` grid, and the server-component wire layer is "payload" — never "RSC" or "Flight"
- uses explicit APIs instead of overloaded magic APIs: `readContext`, `readPromise`, `readData` instead of `use(resource)`; no auto-detection magic anywhere
- effects, events, binds, stable events, actions, and `useTransition` callbacks all receive an `AbortSignal` for cleanup / cancellation (top-level `transition()` is the one exception — it has nothing to cancel against)
- server components become fig payload: fig's own documented wire format (plain newline-delimited JSON), specified and stable rather than an internal framework detail
- dev mode is always strict and diagnostics throw before commit instead of warning after

end with a landing:

- tiny code sample — one small component (e.g. the counter from the quickstart) so the reader sees what fig looks like before deciding to read on
- pointer to doc 2 (quickstart: the common differences from react, with code) as the next step, docs 3-4 for the internals (fiber architecture; async/streaming/hydration)
