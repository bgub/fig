# Quickstart

If you know React, you already know 90% of Fig. This doc is the other 10%: the differences you'll hit in your first hour, with code. (The exhaustive list lives in `concepts/intentional-differences-from-react.md`; the internals are doc 3.)

## Hello Fig

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

Three things to notice: `class` instead of `className`, events declared with `on()` descriptors instead of `onClick` props, and the package split — `@bgub/fig` is the component model, `@bgub/fig-dom` is the browser renderer.

## Native names everywhere

Fig uses the platform's names: `class`, `for`, `tabindex`, `stroke-width`. The React aliases (`className`, `htmlFor`, `onClick`, `ref`, `dangerouslySetInnerHTML`) are compile errors, so migration mistakes surface in the editor, not at runtime.

## Events

```tsx
<input
  events={[
    on("input", (event, signal) => setQuery(event.currentTarget.value)),
    on("keydown", (event) => event.key === "Enter" && submit()),
  ]}
/>
```

- `event` is the native event. No synthetic wrapper, no pooling.
- Propagation is native with no exceptions: `focus`/`blur` don't bubble (use `focusin`/`focusout` for ancestor tracking), and there's no `mouseenter`/`mouseleave` emulation.
- There's no onChange-that-is-really-onInput. `on("input")` is what you want; `change` fires on commit, like the platform says.
- The `signal` aborts on re-entry and on listener removal — the same cancellation contract as everything else in Fig (next section).

## Effects: AbortSignal in, nothing out

Effects receive a signal and must return `undefined` — a React-style returned cleanup is a type error. Abort *is* the cleanup: Fig aborts the signal on dependency change and on unmount.

```tsx
useReactive(
  (signal) => {
    fetch(`/api/search?q=${query}`, { signal })
      .then((res) => res.json())
      .then(setResults);
    // no return. cancellation/cleanup = the signal aborting
  },
  [query],
);
```

For imperative teardown, listen to the signal:

```tsx
useReactive((signal) => {
  const id = setInterval(tick, 1000);
  signal.addEventListener("abort", () => clearInterval(id));
}, []);
```

The effect hooks are named for *when* they run: `useReactive` (React: `useEffect`, after paint), `useBeforePaint` (React: `useLayoutEffect`), `useBeforeLayout` (React: `useInsertionEffect`). There's no mount-only hook; `useReactive(fn, [])` is the idiom.

## No refs — `bind`

DOM access is a normal prop taking `(node, signal)`. No `useRef`, no `forwardRef`, no `.current` threading:

```tsx
<input
  bind={(node, signal) => {
    node.focus(); // node is inferred as HTMLInputElement from the tag
  }}
/>
```

The signal aborts on identity change and unmount. `composeBind(...)` merges several binds. For mutable storage that isn't DOM access, use `useMemo(() => ({ current: null }), [])`.

## Explicit reads instead of `use()`

React's overloaded `use(resource)` is three explicit verbs:

```tsx
const theme = readContext(Theme); // context — a render-time input, not a hook slot
const value = readPromise(promise); // suspends; keyed by promise identity
const user = readData(userResource, id); // suspends; cache-keyed (from @bgub/fig-data)
```

Context objects are their own provider — no `.Provider`, no `Consumer`:

```tsx
const Theme = createContext("light");
<Theme value="dark">
  <App />
</Theme>;
```

## Data is built in

```tsx
import { dataResource, readData, invalidateData } from "@bgub/fig-data";

const userResource = dataResource({
  key: (id: string) => ["user", id],
  load: async (id, { signal }) => fetchUser(id, signal),
});

function Profile({ id }: { id: string }) {
  const user = readData(userResource, id); // suspends until loaded, cached by key
  return <h1>{user.name}</h1>;
}
```

Two freshness verbs make up the whole vocabulary: `invalidateData` (mark stale, reload lazily) and `refreshData` (fetch now). Errors from the loader hit your nearest `ErrorBoundary`; loading states hit your nearest `Suspense`.

## Transitions get a signal too

```tsx
const [isPending, start] = useTransition();

start(async (signal) => {
  const results = await fetch(`/api/heavy?q=${q}`, { signal }).then((r) =>
    r.json(),
  );
  setResults(results); // post-await updates stay in the transition
});
```

Superseded and unmounted runs are aborted and retired — last run wins, with no stale clobbering. Top-level `transition(cb)` exists for scopes without a hook.

## What's gone (and what replaces it)

- `memo()` → nothing needed: Fig's render bailouts preserve child identity, so unchanged siblings skip automatically
- `useRef` → `bind` for DOM access, `useMemo(() => ({ current: null }), [])` for storage
- `useReducer` → userland over `useState`
- Class components, string refs, legacy context, `StrictMode` (dev is always strict), `forwardRef`, `Consumer`, `batchedUpdates` (batching is automatic; `flushSync` is the escape hatch)
- `ErrorBoundary` is a built-in component, not a class you write

## Rename cheat sheet

| React                       | Fig                                  |
| --------------------------- | ------------------------------------ |
| `className` / `htmlFor`     | `class` / `for`                      |
| `onClick={fn}`              | `events={[on("click", fn)]}`         |
| `ref` / `forwardRef`        | `bind`                               |
| `dangerouslySetInnerHTML`   | `unsafeHTML`                         |
| `useEffect`                 | `useReactive`                        |
| `useLayoutEffect`           | `useBeforePaint`                     |
| `useInsertionEffect`        | `useBeforeLayout`                    |
| `useDeferredValue`          | `useLaggedValue`                     |
| `useSyncExternalStore`      | `useExternalStore`                   |
| `useEffectEvent`            | `useStableEvent`                     |
| `startTransition`           | `transition`                         |
| `use(ctx)` / `use(promise)` | `readContext` / `readPromise`        |
| RSC / Flight                | payload (`@bgub/fig-server/payload`) |

Next: doc 3 explains what the runtime actually does with all of this (lanes, scheduling, rendering, commit); doc 4 covers suspense, streaming SSR, and hydration.
