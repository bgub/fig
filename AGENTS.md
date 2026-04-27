# Fig

Fig is a TypeScript re-implementation of React: the core ideas remain, including fibers, lanes, scheduling, diffing, rendering, and hooks.

The goal is to keep React's modern model while dropping legacy cruft such as class components and adopting Fig-specific APIs where they are clearer.

## Design Choices

- No legacy React APIs: no class components, string refs, legacy context, or synthetic event pooling.
- Hooks use Fig names: `useReactive` replaces `useEffect`, `useBeforePaint` replaces `useLayoutEffect`, and `useBeforeLayout` replaces `useInsertionEffect`.
- Effects receive an `AbortSignal` instead of returning cleanup functions; Fig aborts on dependency changes and unmounts.
- `useOnMount(fn)` is the mount-only effect API.
- DOM events use `events={[on("click", (event, signal) => ...)]}` instead of `onClick` props.
- Event callbacks receive native DOM events plus an `AbortSignal`; Fig aborts the previous signal on re-entry and on listener removal.
- DOM event listeners are delegated at the root and mapped to lanes/priorities.
- Non-bubbling DOM events stay direct; focus-like events use capture delegation with Fig bubble semantics.
- DOM node access uses `bind={(node, signal) => ...}` instead of React refs; components forward it as a normal prop.
- Styling should stay separate from the `events` and `bind` APIs.
- Render diagnostics throw before commit for duplicate sibling keys, invalid children, and render-phase state updates.
- Fig intentionally splits React's broad `use(resource)` idea into explicit reads.
- Context uses `createContext` plus `readContext(context)` because context reads are render-time inputs, not hook slots.
- Context reads are tracked so provider updates mark matching consumers, and propagation stops at nested providers of the same context.
- Promises use `readPromise(promise)` as the future Suspense-facing primitive; promise identity matters, not call position.
