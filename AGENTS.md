# Fig

Fig is a TypeScript re-implementation of React: the core ideas remain, including fibers, lanes, scheduling, diffing, rendering, and hooks.

The goal is to keep React's modern model while dropping legacy cruft such as class components and adopting Fig-specific APIs where they are clearer.

## Design Choices

- No legacy React APIs: no class components, string refs, legacy context, or synthetic event pooling.
- Hooks use Fig names: `useReactive` replaces `useEffect`, `useBeforePaint` replaces `useLayoutEffect`, and `useBeforeLayout` replaces `useInsertionEffect`.
- Effects receive an `AbortSignal` instead of returning cleanup functions; Fig aborts on dependency changes and unmounts.
- There is no mount-only effect hook: an empty deps array (`useReactive(fn, [])`) is the mount-once idiom.
- DOM events use `events={[on("click", (event, signal) => ...)]}` instead of `onClick` props.
- Event callbacks receive native DOM events plus an `AbortSignal`; Fig aborts the previous signal on re-entry and on listener removal.
- DOM event listeners are delegated at the root and mapped to lanes/priorities.
- Non-bubbling DOM events stay direct; focus-like events use capture delegation with Fig bubble semantics.
- Portals render into explicit DOM targets while preserving Fig context, effects, and delegated event bubbling through the logical tree.
- DOM node access uses `bind={(node, signal) => ...}` instead of React refs; components forward it as a normal prop.
- Styling should stay separate from the `events` and `bind` APIs.
- Render diagnostics throw before commit for duplicate sibling keys, invalid children, and render-phase state updates; duplicate-key detection and DevTools commit emission are dev-only via inline `process.env.NODE_ENV !== "production"` checks that app bundlers strip.
- There is no `StrictMode` component and no opt-out: development builds always strict-render. Each render pass invokes the component twice — a shadow pass whose hooks, effects, and consumed update queues are discarded and restored, with no reconciliation — and commits only the second invocation; effects and fig-dom `bind` callbacks run, abort, and run again with a fresh signal once per lifetime (tracked via `Effect.strictRan` / `BindSlot.strictRan`, set before the first call so re-entrant runs cannot re-enter the cycle). All strict behaviors use the same inline `NODE_ENV` gates and apply on the client only, not during server rendering.
- `useMemo` and `useCallback` are supported for stable values and callback identities.
- `useExternalStore(subscribe, getSnapshot, getServerSnapshot?)` is the external store API; server render and hydration require `getServerSnapshot`.
- `useReactiveEvent(handler)` is Fig's non-reactive event hook (React's `useEffectEvent` shape with the Fig event contract): it returns a stable function whose handler always sees the latest committed render, receives a trailing `AbortSignal`, and aborts the previous invocation's signal on re-entry and on unmount; calls after unmount run the last committed handler with an already-aborted signal. Handlers swap at commit before the before-layout effect phase; calling one during render or server render throws, and the strict shadow pass never publishes.
- `useReducer` is intentionally not built in; reducer abstractions can live in libraries on top of `useState`.
- `ErrorBoundary` catches render and Fig effect errors with a sticky fallback; reset by remounting/changing the boundary key.
- Error boundaries do not catch promises, event handler errors, async callback errors, server render errors, or host commit failures.
- Fig intentionally splits React's broad `use(resource)` idea into explicit reads.
- Context uses `createContext` plus `readContext(context)` because context reads are render-time inputs, not hook slots.
- Context reads are tracked so provider updates mark matching consumers, and propagation stops at nested providers of the same context.
- Promises use `readPromise(promise)` as the future Suspense-facing primitive; promise identity matters, not call position.
- Server streaming uses nonce-compatible inline scripts; no external runtime format.
- Server Suspense streams fallbacks first, then completed content and partial segments; server errors recover only through Suspense client-render markers.
- Hydration is Suspense-boundary selective: server markers can stay dehydrated until background work or interaction hydrates that boundary.
- Hydration queues replayable events blocked by pending Suspense hydration and replays them after the boundary hydrates.
- Suspense retries after a committed fallback are scheduled on React-style retry lanes: low priority, excluded from expiration, reusing the boundary's retry lane when a retry suspends again.
- A dehydrated Suspense boundary whose hydration attempt suspends stays dehydrated — the server DOM is preserved and the attached thenable ping retries hydration; no fallback is rendered over server content.
- Uncaught render errors rethrow to `flushSync` callers; outside `flushSync` they go to the root's `onUncaughtError`, or rethrow from a detached task when no handler exists, so scheduler ticks never die.
