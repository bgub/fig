# Intentional Differences from React

Fig keeps React's modern runtime model — fibers, lanes, scheduling, hooks,
Suspense, streaming, selective hydration — and drops the rest. This is the
running list of deliberate divergences, written for readers who know React.
Each area's full contract and rationale live in the matching file under
[`concepts/`](../concepts/README.md) — this list is the orientation, not the
spec.

## General

- No legacy APIs: no class components, string refs, legacy context, or
  synthetic event pooling. Root API only — `createRoot`/`hydrateRoot`; there
  is no `render(children, container)`.
- Every export has exactly one home: behavior lives in the package whose
  domain defines it (`@bgub/fig` the component model, `@bgub/fig-dom` the
  browser boundary, `@bgub/fig-reconciler` renderer authoring,
  `@bgub/fig-server` server rendering + payload, `@bgub/fig` runtime
  data APIs). Renderer packages never mirror core symbols; a package
  re-exports a _type_ only when it appears in that package's own public
  signatures.
- No `StrictMode` component and no opt-out: development always strict-renders.
  Each pass renders twice (the shadow pass is discarded), and first-time
  effects and `bind` callbacks run, abort, and run again with a fresh signal.
  Client-only; production builds strip all of it.
- Batching is automatic and has no opt-in API: same-tick updates and root
  renders coalesce into one pass. There is no `batchedUpdates`; `flushSync`
  is the only escape hatch.
- Effects receive an `AbortSignal` instead of returning cleanup functions;
  Fig aborts on dependency change and unmount. Effects must return
  `undefined`, which makes a React-style returned cleanup a type error. There
  is no mount-only hook — `useReactive(fn, [])` is the idiom.
- React's broad `use(resource)` is split into explicit reads: `readContext`
  (context is a render-time input, not a hook slot), `readPromise` (identity-
  keyed, not call-position-keyed), and `readData` from `@bgub/fig`
  (cache-keyed).
- Context objects are their own provider (`<Ctx value={...}>`); there is no
  `Consumer` and no `displayName`.
- No `useReducer` — reducer abstractions are userland over `useState`. No
  `memo()` — tiered render bailouts preserve child identity so siblings bail
  automatically; `useMemo(() => <X/>, deps)` covers the rest. No `useRef` —
  `useMemo(() => ({ current: null }), [])` for mutable storage, `bind` for
  DOM access.
- `lazy(load)` expects the loader to return the component — no `{ default }`
  unwrapping, no special element type; it is a plain component over
  `readPromise`.
- `ErrorBoundary` is a component, not a class protocol: sticky fallback,
  reset by remount/key change, `fallback` may be `(error, info) => FigNode`.
  It does not catch promises, event handler errors, async callbacks, server
  render errors, or host commit failures.
- Data is a separate package (`@bgub/fig`) that renderers never bundle;
  resources carry the data-store factory on an internal symbol so importing the
  package has no registration side effect. Keys are explicit arrays with a strict
  canonical encoder — no `JSON.stringify` traps. The verb set is deliberately
  narrow: `invalidateData` (mark stale, lazily reload — including resetting
  cached rejections) and `refreshData` (fetch now; never rejects, returns a
  result union). The ambient free functions work only while Fig executes
  synchronously (render, events, actions, effects); async flows capture the
  explicit handle (`readDataStore()` or `root.data`).
- Data-protocol _types_ (`FigDataStoreHandle`, `FigDataHydrationEntry`, ...)
  export from `@bgub/fig`; runtime data APIs export exclusively from
  `@bgub/fig`.
- Asset resources replace React 19 hoistables: explicit creators
  (`stylesheet`, `preload`, `modulepreload`, `font`, `preconnect`, `script`,
  `title`, `meta`) producing plain data with documented dedupe keys; host
  `<link>`/`<title>`/`<meta>`/`<script>` tags lower into the same registry in
  document mode.
- Server rendering is Web-`ReadableStream`-first with a synchronous result
  object (`stream` plus `shellReady`/`headReady`/`allReady` promises) —
  no shell-gated promise like React's `renderToReadableStream`, and no
  `onShellError` callback — a shell failure rejects `shellReady`, which is the
  one channel for that event. Server render
  errors cross the wire only through `onError → { digest?, message? }`
  (authoritative; production defaults to empty, development includes the
  message), on both the HTML and payload renderers.
- Transitions: `transition(callback)` and `useTransition()` are explicit
  priority scopes; async callbacks keep `isPending` true until they settle
  and post-`await` updates stay in scope. `useActionState` keeps React's
  argument order; server action transport is left to framework layers.
- Async work is cancellable, unlike React 19: `useTransition` callbacks and
  `useActionState` actions receive an `AbortSignal` (trailing, loader-style
  for actions) that aborts on supersede, unmount, and Activity hide. Each
  hook is one cancellation domain. An aborted run is retired: its pending
  slot releases immediately, its rejection is swallowed (an aborted fetch
  rejecting is the happy path), and — for actions — its result can never
  clobber newer state (last-run-wins; no React-style serial action queue).
  Aborting is a signal, not an unwind: state a transition callback already
  set stays committed. Top-level `transition()` has no signal — it has no
  hook identity to supersede or lifetime to unmount.
- Uncaught render errors rethrow to `flushSync` callers, else go to the
  root's `onUncaughtError`, else rethrow from a detached task — scheduler
  ticks never die silently.
- The cooperative scheduler is an internal fig-reconciler module, not a
  published package, and exposes no `unstable_` APIs. Renderer boundaries
  never leak lanes or fibers; priority crosses as
  `"default" | "continuous" | "discrete"` strings.
- Host props use native DOM names: `class`, `for`, `tabindex`,
  `stroke-width`, `xlink:href`. Raw trusted HTML is `unsafeHTML` (a plain,
  scary-named string prop), not `dangerouslySetInnerHTML`.
- Form `value` props are authoritative at commit time, not synchronously
  locked after native input events. `value` controls the live DOM value;
  `defaultValue` owns the default value and HTML representation.
- JSX host-prop types come from the renderer: core's `JSX.IntrinsicElements`
  is deliberately empty and `@bgub/fig-dom` augments it with a per-tag
  `HostProps<E>` map, so `bind` infers the concrete element type per tag
  (no `forwardRef` gymnastics), `events`/`style`/`unsafeHTML` are
  shape-checked (numeric style values are compile errors, matching the
  runtime), and React-habit props — `className`, `htmlFor`, `ref`,
  `dangerouslySetInnerHTML`, and the whole `on*` family — are rejected at
  compile time. Attributes stay an open, natively-named vocabulary; no
  React-style per-element attribute catalogs.
- Render diagnostics throw before commit (duplicate keys, invalid children,
  render-phase updates, invalid DOM nesting) instead of warning after it.

## Naming

- Effects: `useReactive` (useEffect), `useBeforePaint` (useLayoutEffect),
  `useBeforeLayout` (useInsertionEffect) — named for _when_ they run.
- `useLaggedValue` (useDeferredValue), `useExternalStore`
  (useSyncExternalStore), `transition` (startTransition).
- `useStableEvent` (useEffectEvent): "stable" names the identity guarantee
  rather than tying the hook to effects — Fig's version is the general
  escape-from-reactivity primitive (usable from handlers, timers, and
  subscriptions, not effects-only) and carries the Fig event contract
  (trailing `AbortSignal`, aborted on re-entry and unmount). Not `useEvent`:
  bare "event" collides with the `events`/`on()` listener vocabulary.
- `StateSetter<S>` is the one `useState` setter type — there is no
  `Dispatch`/`SetStateAction` reducer vocabulary.
- `FigNode` is the one children type — no `FigChild`/`ReactChild`-style
  duplicate. (Internally, `collectChildren` returns `NormalizedChild`:
  element | portal | string.)
- `bind` (ref), `events` (the `on*` prop family), `unsafeHTML`
  (dangerouslySetInnerHTML), `readContext`/`readPromise`/`readData` (use).
- The server render entry points form one grid — `renderToStream`,
  `renderToDocumentStream`, `renderToHtml`, `renderToDocumentHtml` — and none
  reuse React names: `renderToHtml` is honestly "the streamed output,
  buffered" (runtime scripts included), not React's settled, script-free
  `renderToString`.
- `prerender` is the separate static semantic: it waits for all async server
  work before emitting HTML, so completed Suspense content appears in logical
  position without streaming reveal scripts.
- The server-component layer is **payload**, never "RSC" or "Flight" — those
  are React brands (see Payload).

## Events

- Listeners are declared as `events={[on("click", (event, signal) => ...)]}`
  — an array of `on()` descriptors, not `onClick` props. Callbacks receive
  the **native** event plus an `AbortSignal` that aborts on re-entry and on
  listener removal.
- Bubbling events are delegated at the root, mapped to lanes/priorities, and
  bubble through the _logical_ tree — portals included.
- Propagation is native with no exceptions: non-bubbling events — `focus` and
  `blur` included — attach directly and fire only on their target. Fig does
  not emulate React's bubbling `focus`/`blur`; ancestor focus tracking uses
  the platform's `focusin`/`focusout` (or a `capture: true` listener, as in
  the real DOM). No `mouseenter`/`mouseleave` emulation either.
- `change` and `input` keep native semantics — there is no
  onChange-that-is-really-onInput remapping (a dev warning steers `onChange`
  habits to `on("input")`).
- DOM node access is `bind={(node, signal) => ...}`, forwarded as a normal
  prop — no `forwardRef`, no ref objects. The signal aborts on identity
  change and unmount; `composeBind` merges binds and accepts falsy entries.
- Hydration queues replayable events blocked by pending Suspense hydration
  and replays them (two-phase, through the logical tree) after the boundary
  hydrates.

## Payload

- Fig's server-component layer is `@bgub/fig-server/payload` — its own wire
  layer, not React Flight: a semantic row model plus a pluggable codec. The
  default codec is newline-delimited JSON with MIME
  `text/x-fig-payload; codec=json; charset=utf-8`; refresh requests use
  `x-fig-payload-boundary`, and payload-rendered ids use `fig-pl-` prefixes.
- API: `renderToPayloadStream` (server), `createPayloadResponse` /
  `fetchPayload` / `processStream` (client), `PayloadBoundary` +
  `refreshBoundary` for targeted server-rendered boundary refreshes (no React
  equivalent — React refetches whole trees).
- Client references travel as structured `{ id, exportName?, ssr? }`
  metadata: the server splits the authored `"<module>#<export>"` convention
  once at serialization; ids stay opaque unique keys, and the client never
  string-parses them. Loading is a `loadClientReference(metadata)` function,
  not a bundler manifest object; `ssr`-capable references server-render with
  their modules preloaded.
- Error rows carry the `onError`-controlled `{ digest?, message? }` payload —
  raw server exception text never ships in production.
- Deliberately absent from the row model: server actions and temporary
  references. Binary row encodings are allowed as codecs; JSON is just the
  readable default.
