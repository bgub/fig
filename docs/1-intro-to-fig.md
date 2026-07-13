# Intro to Fig

_Note: this doc is for people who already know React! If you don't, skip ahead to the next page which goes into more detail._

In general, Fig follows a simple rule: when syntax is identical to React, use the same API name. When it's different, use a different name.

## What's the same as React?

- UI as a declarative function of state
- Fiber/concurrent rendering
- Platform-agnostic core (you can use Fig in web, CLI, native, desktop)
- Hooks instead of signals (see the [FAQ](./faq.md))
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

The signal aborts on identity change and unmount. `composeBind(...)` merges several binds. For mutable storage that isn't DOM access, use `useMemo(() => ({ current: null }), [])`. For DOM access from custom hooks or from event handlers, see the [FAQ](./faq.md).

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

Superseded and unmounted runs are aborted and retired: their pending slot releases immediately. A callback that ignores an abort signal and keeps running may still update state. (`useActionState`, unlike transitions, generation-guards results so the last run wins.) Top-level `transition(cb)` exists for scopes without a hook.

### SSR

Fig handles SSR and streaming similarly to React, but there are some implementation differences.

### Server components and directives

In Fig, all code is _isomorphic_ (meaning it can run on either server or client) unless it ends in `.server.ts(x)`. There are no `"use client"` or `"use server"` directives.

A server component is a Fig component that renders into a Payload stream instead of HTML. Payload is Fig's own semantic row format, with a readable JSON codec by default. React's server-component details are mostly internal and exposed to frameworks, but Fig exposes the whole round trip as first-class APIs.

Here is the whole round trip — four files, one interactive component, one refreshable boundary.

An interactive component. Nothing marks it as client code here; the tree does that:

```tsx
// like-button.tsx
export function LikeButton({ postId }: { postId: string }) {
  const [likes, setLikes] = useState(0);
  const addLike = on("click", () => setLikes((n) => n + 1));

  return (
    <button events={[addLike]}>
      ♥ {likes} · post {postId}
    </button>
  );
}
```

The tree. The `.server.tsx` suffix keeps it out of client bundles, and `clientReference` is the boundary between server and client code: the component serializes into the payload as an id instead of rendering. Ids are opaque; `"<module>#<export>"` is the convention bundler tooling uses, written by hand here:

```tsx
// app.server.tsx
import { clientReference } from "@bgub/fig";
import { PayloadBoundary } from "@bgub/fig-server/payload";

export const LikeButton = clientReference<{ postId: string }>({
  id: "like-button.tsx#LikeButton",
  load: () => import("./like-button.tsx"),
});

export function Profile({ id }: { id: string }) {
  return (
    <section>
      <h1>User #{id}</h1>
      <p>Rendered on the server at {new Date().toLocaleTimeString()}</p>
    </section>
  );
}

export function ProfilePage({ id }: { id: string }) {
  return (
    <main>
      <PayloadBoundary id="profile">
        <Profile id={id} />
      </PayloadBoundary>
      <LikeButton postId={id} />
    </main>
  );
}
```

The server — routing shown with Hono, but anything that speaks `Request`/`Response` works. One route serves both the first render and refreshes: a refresh request names its boundary in a header and gets back only that boundary's contents:

```tsx
// server.tsx
import {
  PAYLOAD_BOUNDARY_HEADER,
  renderToPayloadStream,
} from "@bgub/fig-server/payload";
import { Profile, ProfilePage } from "./app.server.tsx";

const shell = `<!doctype html>
<div id="app"></div>
<script type="module" src="/client.js"></script>`;

export const app = new Hono();

app.get("/", (c) => c.html(shell));

app.get("/profile/:id", (c) => {
  const id = c.req.param("id");
  const boundary = c.req.header(PAYLOAD_BOUNDARY_HEADER);
  const result =
    boundary === "profile"
      ? renderToPayloadStream(<Profile id={id} />, {
          refreshBoundary: boundary,
        })
      : renderToPayloadStream(<ProfilePage id={id} />);

  return new Response(result.stream, {
    headers: { "content-type": result.contentType },
  });
});
```

Serve the next file, bundled for the browser, as `/client.js` (build it with `jsxImportSource: "@bgub/fig-dom"`).

The client entry creates a payload consumer — the decoding end of the wire — binds it to the DOM, and fetches. The manifest is the other half of `clientReference`: it maps ids back to real modules:

```ts
// client.ts — runs in the browser
import { createRoot } from "@bgub/fig-dom";
import { createPayloadConsumer } from "@bgub/fig-server/payload";

const clientManifest: Record<string, () => Promise<unknown>> = {
  "like-button.tsx#LikeButton": () => import("./like-button.tsx"),
};

const consumer = createPayloadConsumer({
  loadClientReference: ({ id }) => clientManifest[id](),
});

consumer.bindRoot(createRoot(document.getElementById("app")!));
await consumer.fetch("/profile/42");
```

Later, refresh only the marked boundary:

```ts
await consumer.fetch("/profile/42", { refreshBoundary: "profile" });
```

The server re-renders `<Profile>`, the refresh row replaces the boundary's contents (the timestamp changes), and the root bound by `bindRoot` re-renders automatically. The `LikeButton` outside the boundary stays mounted and keeps its count.

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
