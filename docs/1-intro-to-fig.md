# Intro to Fig

_Note: this doc is for people who already know React! If you don't, skip ahead to the next page which goes into more detail._

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

In Fig, all code is _isomorphic_ (meaning it can run on either server or client) unless it ends in `.server.ts(x)`. There are no `"use client"` or `"use server"` directives.

A server component is a Fig component that renders into a Payload stream instead of HTML. Payload is Fig's own semantic row format, with a readable JSON codec by default. React's server-component details are mostly internal and exposed to frameworks, but Fig exposes the whole round trip as first-class APIs.

On the server, render a tree and return its stream:

```tsx
import {
  PayloadBoundary,
  renderToPayloadStream,
} from "@bgub/fig-server/payload";

const result = renderToPayloadStream(
  <PayloadBoundary id="profile">
    <ProfilePage id="42" />
  </PayloadBoundary>,
);

return new Response(result.stream, {
  headers: { "content-type": result.contentType },
});
```

On the client, decode the stream and bind its root to the DOM:

```ts
import { createRoot } from "@bgub/fig-dom";
import { createPayloadResponse, fetchPayload } from "@bgub/fig-server/payload";

const payload = createPayloadResponse({
  loadClientReference: ({ id }) => clientManifest[id](),
});

await fetchPayload(payload, "/profile/42");
await payload.rootReady;
payload.bindRoot(createRoot(document.getElementById("app")!));
```

Later, refresh only the marked boundary. The surrounding tree stays mounted:

```ts
await fetchPayload(payload, "/profile/42", {
  refreshBoundary: "profile",
});
```

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

`ErrorBoundary` is a component, not a class protocol. Its fallback can inspect the error directly, and changing the boundary's key resets its sticky error state:

```tsx
import { ErrorBoundary, invalidateDataError, useState } from "@bgub/fig";
import { on } from "@bgub/fig-dom";

function ProfilePage({ id }: { id: string }) {
  const [retryKey, setRetryKey] = useState(0);

  return (
    <ErrorBoundary
      key={retryKey}
      fallback={(error) => (
        <button
          events={[
            on("click", () => {
              invalidateDataError(error);
              setRetryKey((key) => key + 1);
            }),
          ]}
        >
          Try again
        </button>
      )}
    >
      <Profile id={id} />
    </ErrorBoundary>
  );
}
```

Boundaries catch render and effect errors. Suspended promises go to `Suspense`; event-handler and other asynchronous errors remain the caller's responsibility.

### Granular asset declarations

Assets are explicit data attached to the subtree that needs them:

```tsx
import { assets, preconnect, stylesheet } from "@bgub/fig";

function Chart() {
  return assets(
    [
      stylesheet("/chart.css", { precedence: "components" }),
      preconnect("https://tiles.example.com"),
    ],
    <section class="chart">...</section>,
  );
}
```

Fig discovers these declarations during rendering and deduplicates them across server rendering, Payload, and client insertion. Streamed content waits for blocking stylesheets before reveal, preventing a flash of unstyled content. The full creator set also covers scripts, preloads, module preloads, fonts, titles, and metadata.

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
