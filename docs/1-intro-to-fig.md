# Intro to Fig

*Note: this doc is for people who already know React! If you don't, skip ahead to the next page which goes into more detail.*

In general, Fig follows a simple rule: when syntax is identical to React, use the same API name. When it's different, use a different name.

## What's the same as React?
- UI as a declarative function of state
- Fiber/concurrent rendering
- Platform-agnostic core (you can use Fig in web, CLI, native, desktop)
- Hooks instead of signals (see the FAQ)
- The following APIs: `useState`, `useMemo`, `useCallback`, `useId`, `useDeferredValue`, `useSyncExternalStore`, `createElement`, `isValidElement`, `Fragment`, `createPortal`, `flushSync`, `Suspense`, `Activity`, `createRoot`, `hydrateRoot`, root `.render()` and `.unmount()` 

## What's different?

### Props

Fig uses native names for props: `class`, `for`, `tabindex`, etc. No `className` allowed!

### Events

```tsx
<input
  events={[
    on("input", (event, signal) => {
      const input = event.currentTarget;
      if (input instanceof HTMLInputElement) setQuery(input.value);
    }),
    on("keydown", (event) => event.key === "Enter" && submit()),
  ]}
/>
```

- `event` is the native event (not synthetic like React)
- Propagation is native with no exceptions: `focus`/`blur` don't bubble (use `focusin`/`focusout` for ancestor tracking), and there's no `mouseenter`/`mouseleave` emulation.
- There's no onChange-that-is-really-onInput. `on("input")` is what you want; `change` fires on commit.
- The `signal` aborts on re-entry and on listener removal.

### Effects: AbortSignal in, nothing out

Effects receive a signal and must return `undefined` — a React-style returned cleanup is a type error. Abort _is_ the cleanup: Fig aborts the signal on dependency change and on unmount.

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

The effect hooks are named for when they run: `useReactive` (React: `useEffect`, after paint), `useBeforePaint` (React: `useLayoutEffect`), `useBeforeLayout` (React: `useInsertionEffect`). For a mount-only hook, use `useReactive(fn, [])`.

### No refs — `bind`

DOM access is a normal prop taking `(node, signal)`. No `useRef`, `forwardRef`, or `.current` threading:

```tsx
<input
  bind={(node, signal) => {
    node.focus(); // node is inferred as HTMLInputElement from the tag
  }}
/>
```

The signal aborts on identity change and unmount. `composeBind(...)` merges several binds. For mutable storage that isn't DOM access, use `useMemo(() => ({ current: null }), [])`.

### Context objects are their own provider

No `.Provider` or `Consumer`:

```tsx
const Theme = createContext("light");

<Theme value="dark">
  <App />
</Theme>;
```

### Transitions get a signal too

```tsx
const [isPending, start] = useTransition();

start(async (signal) => {
  const results = await fetch(`/api/heavy?q=${q}`, { signal }).then((r) =>
    r.json(),
  );
  setResults(results); // post-await updates stay in the transition
});
```

Superseded and unmounted runs are aborted and retired: their pending slot releases immediately. A callback that ignores an abort signal and keeps running may still update state. (`useActionState`, unlike transitions, generation-guards results so the
last run wins.) Top-level `transition(cb)` exists for scopes without a hook.

### SSR

Fig handles SSR and streaming similarly to React, but there are some implementation differences. 

### Server components and directives

In Fig, all code is *isomorphic* (meaning it can run on either server or client) unless it ends in `.server.ts(x)`. There are no `"use client"` or `"use server"` directives.

A server component is just a React component that you serialize into JSON. Fig uses a special serialization format ("Payload") that's different from RSCs. React's server component details are mostly internal and exposed to frameworks only, but Fig gives you first-class functions to deal with server components:
- Serializing a React component into "Payload" (TODO: add demo)
- Rendering a "Payload" stream (TODO: add demo)
- Refreshing a server boundary (TODO: add demo)

### Explicit reads instead of `use()`

React's `use(resource)` splits into three explicit functions:

```tsx
const theme = readContext(Theme); // context — a render-time input, not a hook slot
const value = readPromise(promise); // suspends; keyed by promise identity
const user = readData(userResource, id); // suspends; cache-keyed (from @bgub/fig)
```

## What's new?

### Data is built in

I lied in the previous section - `readData` isn't actually an equivalent to something that exists in React today. Instead it's a new primitive meant to be used by libraries like React Query.

Fig allows you to declare data resources with a key and a loader. It handles async loader functions (suspends by throwing a promise) and keeps track of which fibers use which resources so it can re-render. It also handles SSR streaming properly -- when you SSR a component and fetch data there, Fig emits `<script>` tags that inject and hydrate that same exact data on the client.

```tsx
import { dataResource, readData, invalidateData } from "@bgub/fig";

const userResource = dataResource({
  key: (id: string) => ["user", id],
  load: async (id, { signal }) => fetchUser(id, signal),
});

function Profile({ id }: { id: string }) {
  const user = readData(userResource, id); // suspends until loaded, cached by key
  return <h1>{user.name}</h1>;
}
```

You can use `invalidateData` to mark a key stale, `invalidateDataPrefix` to mark a key prefix stale, and `refreshData` to immediately refresh data. Errors from the loader hit your nearest `ErrorBoundary`.

### Error boundaries are built in

TODO

### Granular asset declarations

## What's gone (and what replaces it)

- `memo()` → nothing needed: Fig's render bailouts preserve child identity, so unchanged siblings skip automatically
- `useRef` → `bind` for DOM access, `useMemo(() => ({ current: null }), [])` for storage
- `useReducer` → userland over `useState`
- Class components, string refs, legacy context, `StrictMode` (dev is always strict), `forwardRef`, `Consumer`, `batchedUpdates` (batching is automatic; `flushSync` is the escape hatch)

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
| `useEffectEvent`            | `useStableEvent`                     |
| `startTransition`           | `transition`                         |
| `use(ctx)` / `use(promise)` | `readContext` / `readPromise`        |
| RSC / Flight                | payload (`@bgub/fig-server/payload`) |

The next doc explains what the runtime actually does with all of this (lanes, scheduling, rendering, commit); doc 4 covers suspense, streaming SSR, and hydration.
