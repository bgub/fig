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
- Refs and styling should stay separate from the `events` API.
