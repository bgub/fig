# quickstart

if you know react, you already know 90% of fig. this doc is the other 10% — the differences you'll hit in your first hour, with code. (the exhaustive list lives in concepts/intentional-differences-from-react.md; the internals are doc 3.)

## hello fig

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

three things to notice: `class` not `className`, events declared via `on()` descriptors not `onClick` props, and the packages — `@bgub/fig` is the component model, `@bgub/fig-dom` is the browser.

## native names everywhere

fig uses the platform's names: `class`, `for`, `tabindex`, `stroke-width`. the react aliases (`className`, `htmlFor`, `onClick`, `ref`, `dangerouslySetInnerHTML`) aren't just unsupported — they're COMPILE errors, so migration mistakes surface in the editor, not at runtime.

## events

```tsx
<input
  events={[
    on("input", (event, signal) => setQuery(event.currentTarget.value)),
    on("keydown", (event) => event.key === "Enter" && submit()),
  ]}
/>
```

- `event` is the NATIVE event — no synthetic wrapper, no pooling
- propagation is native with no exceptions: `focus`/`blur` don't bubble (use `focusin`/`focusout` for ancestor tracking), no `mouseenter`/`mouseleave` emulation
- there is no onChange-that-is-really-onInput: `on("input")` is what you want; `change` fires on commit like the platform says
- the `signal` aborts on re-entry and listener removal — same cancellation contract as everything else in fig (next section)

## effects: AbortSignal in, nothing out

effects receive a signal and must return `undefined` — a react-style returned cleanup is a type error. abort IS the cleanup: fig aborts on dependency change and on unmount.

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

for imperative teardown, listen to the signal:

```tsx
useReactive((signal) => {
  const id = setInterval(tick, 1000);
  signal.addEventListener("abort", () => clearInterval(id));
}, []);
```

the effect hooks are named for WHEN they run: `useReactive` (react: `useEffect`, after paint), `useBeforePaint` (react: `useLayoutEffect`), `useBeforeLayout` (react: `useInsertionEffect`). there's no mount-only hook — `useReactive(fn, [])` is the idiom.

## no refs — `bind`

DOM access is a normal prop taking `(node, signal)`. no `useRef`, no `forwardRef`, no `.current` threading:

```tsx
<input
  bind={(node, signal) => {
    node.focus(); // node is inferred as HTMLInputElement from the tag
  }}
/>
```

the signal aborts on identity change and unmount. `composeBind(...)` merges several binds. for mutable storage that isn't DOM access, `useMemo(() => ({ current: null }), [])`.

## explicit reads instead of `use()`

react's overloaded `use(resource)` is three explicit verbs:

```tsx
const theme = readContext(Theme); // context — a render-time input, not a hook slot
const value = readPromise(promise); // suspends; keyed by promise identity
const user = readData(userResource, id); // suspends; cache-keyed (from @bgub/fig-data)
```

context objects are their own provider — no `.Provider`, no `Consumer`:

```tsx
const Theme = createContext("light");
<Theme value="dark">
  <App />
</Theme>;
```

## data is built in

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

two freshness verbs, that's the whole vocabulary: `invalidateData` (mark stale, reload lazily) and `refreshData` (fetch now). errors from the loader hit your nearest `ErrorBoundary`; loading states hit your nearest `Suspense`.

## transitions get a signal too

```tsx
const [isPending, start] = useTransition();

start(async (signal) => {
  const results = await fetch(`/api/heavy?q=${q}`, { signal }).then((r) =>
    r.json(),
  );
  setResults(results); // post-await updates stay in the transition
});
```

superseded/unmounted runs are aborted and retired — last run wins, no stale clobbering. top-level `transition(cb)` exists for scopes without a hook.

## what's gone (and what replaces it)

- `memo()` → nothing needed: fig's render bailouts preserve child identity, so unchanged siblings skip automatically
- `useRef` → `bind` for DOM, `useMemo(() => ({ current: null }), [])` for storage
- `useReducer` → userland over `useState`
- class components, string refs, legacy context, `StrictMode` (dev is ALWAYS strict), `forwardRef`, `Consumer`, `batchedUpdates` (batching is automatic; `flushSync` is the escape hatch)
- `ErrorBoundary` is a built-in component, not a class you write

## rename cheat sheet

| react                       | fig                                  |
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

next: doc 3 explains what the runtime actually does with all of this (lanes, scheduling, rendering, commit); doc 4 covers suspense, streaming SSR, and hydration.
