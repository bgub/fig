# Fig

Fig is a TypeScript re-implementation of React: the core ideas remain, including fibers, lanes, scheduling, diffing, rendering, and hooks.

The goal is to keep the modern model while dropping legacy cruft such as class components, and to use Fig-specific API names where they improve clarity, for example `useReactive`, `useOnMount`, `useBeforePaint`, and `useBeforeLayout`.

Effect hooks receive an `AbortSignal` instead of returning cleanup functions; Fig aborts the signal on dependency changes and unmounts.
