# @bgub/fig

Core primitives for Fig, a TypeScript re-implementation of React's modern
component model. Renderers live in `@bgub/fig-dom` and `@bgub/fig-server`.

## Installation

```bash
pnpm add @bgub/fig
```

Fig packages are ESM-only, require Node `^20.19.0 || >=22.12.0` for Node
runtime entry points, and rely on package `exports`. TypeScript projects should
use `moduleResolution: "bundler"`, `"node16"`, or `"nodenext"`, not the legacy
`"node"` resolver, so subpaths such as `@bgub/fig/jsx-runtime` resolve with
their types.

## Usage

```tsx
import { createRoot, on } from "@bgub/fig-dom";
import { Suspense, readPromise, useState } from "@bgub/fig";

const message = Promise.resolve("Ready");

function Message({ value }: { value: Promise<string> }) {
  return <span>{readPromise(value)}</span>;
}

function App() {
  const [count, setCount] = useState(0);

  return (
    <main>
      <button events={[on("click", () => setCount((value) => value + 1))]}>
        Count {count}
      </button>
      <Suspense fallback={<span>Loading</span>}>
        <Message value={message} />
      </Suspense>
    </main>
  );
}

const container = document.getElementById("root");
if (container === null) throw new Error("Missing root.");

createRoot(container).render(<App />);
```

## Core API

- Elements: `createElement`, `Fragment`, and the JSX runtime.
- State and memoization: `useState`, `useDeferredValue`, `useMemo`, and
  `useCallback`.
- Stable identifiers: `useId()` generates IDs that match server render and
  hydration output.
- Context: `createContext(defaultValue)` plus render-time
  `readContext(context)`.
- Effects: `useReactive`, `useBeforePaint`, and `useBeforeLayout`. Effects
  receive an `AbortSignal`; attach cleanup to `signal.abort`. An empty deps
  array runs an effect once per mount.
- Strict development semantics, with no `StrictMode` component or opt-out:
  development builds render components twice per pass (discarding the first
  result) and run first-time effects and renderer `bind` callbacks twice with
  an abort in between, so impure renders and signal-ignoring cleanup surface
  early. Production builds strip these checks.
- `useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot?)` reads external
  stores. Server rendering and hydration require `getServerSnapshot`.
- `useStableEvent(handler)` returns a stable function for effect-held
  callbacks (subscriptions, sockets, timers). The handler always sees the
  latest committed render and follows the Fig event contract: it receives a
  trailing `AbortSignal`, and the previous invocation's signal aborts on
  re-entry and on unmount. Calls after unmount receive an already-aborted
  signal; calling it during render throws.
- `Suspense` catches pending `readPromise(promise)` reads and shows `fallback`
  until the promise settles.
- Data resources live in `@bgub/fig`. Use `dataResource(...)` plus
  render-time `readData(...)` for keyed async values that need Suspense,
  deduping, invalidation, refresh, server hydration, and DevTools visibility.
- `lazy(load)` creates a component that suspends until `load()` resolves to a
  component type.
- `<Activity mode="visible" | "hidden">` hides a subtree while preserving its
  state: hiding hides the DOM (through portals) and aborts effects, binds, and
  reactive events; revealing restores the DOM and re-runs them. Trees that
  mount hidden defer their effects until first reveal, and updates inside
  hidden trees prerender at idle priority. Server rendering streams hidden
  content inside an inert template; the client keeps it dehydrated — zero
  hydration cost — until reveal, then adopts the server DOM.
- `ErrorBoundary` catches render and Fig effect errors. Use `onError` for
  reporting and change the boundary key to reset sticky fallback state. Data
  resource load failures report failed keys on `info.dataResourceKeys`, so
  recovery flows can refresh or invalidate those keys before resetting.
- `transition(callback)` and `useTransition()` mark updates that may preserve
  already-revealed Suspense content while new work is pending. Updates scheduled
  inside the callback run at transition priority, including updates after an
  `await` while an async transition callback is still pending. If the callback
  returns a promise, `useTransition()` keeps `isPending` true until it settles.
  Server rendering runs transition callbacks immediately and never exposes
  pending state.
- `useActionState(action, initialState)` matches React's argument order while
  staying client-side in Fig today. Actions receive the previous state first,
  then the runner's arguments, then an `AbortSignal` Fig appends — declare the
  trailing signal parameter (it drives `Args` inference):

  ```ts
  const [count, add, isPending] = useActionState(
    (previous: number, amount: number, signal: AbortSignal) => {
      return fetchNext(previous + amount, { signal });
    },
    0,
  );
  add(2); // Fig appends the signal; callers pass only the args.
  ```

  Runs are last-run-wins: a new run aborts the previous one's signal and
  retires it, so a stale settlement (value or rejection) never touches state,
  error, or pending. The signal also aborts on unmount and Activity hide.
  Server actions can layer on top later without changing the hook shape.

- Document resources: `assets([...], children)` attaches resources to a
  subtree while rendering only `children` on the client. Resource helpers include
  `stylesheet`, `preload`, `font`, `preconnect`, `title`, `meta`, and `script`.
  Server rendering exposes `title` and `meta` as document head output; stream-safe
  assets such as stylesheets can be emitted near the segments that depend on
  them.

## Renderer APIs

Use `@bgub/fig-dom` for browser rendering:

- `createRoot(container)` renders client roots.
- `hydrateRoot(container, children, options?)` hydrates server HTML and reports
  recoverable mismatches with `onRecoverableError`.
- `createPortal(children, container, key?)` renders into external DOM targets.
- DOM events use `events={[on("click", (event, signal) => ...)]}`.
- DOM node access uses `bind={(node, signal) => ...}`.
- Raw trusted HTML uses `unsafeHTML="<p>trusted html</p>"`.

Use `@bgub/fig-server` for streaming server rendering with
`renderToStream` or `renderToHtml`.

## Data Resources

Key-addressable async data resources are part of the core package. Data
resources are render-time inputs with stable keys: Fig dedupes loads by
key, wires missing values to `Suspense`, tracks committed readers, and
lets applications invalidate or refresh specific entries and key
prefixes. The store implementation travels with `dataResource` itself, so
bundles that never define a resource never ship it.

### Basic Usage

```tsx
import { Suspense } from "@bgub/fig";
import { createRoot, on } from "@bgub/fig-dom";
import { dataResource, readData, refreshData } from "@bgub/fig";

const userResource = dataResource({
  key: (id: string) => ["user", id],
  load: async (id: string, { signal }) => {
    const response = await fetch(`/api/users/${id}`, { signal });
    return response.json() as Promise<{ name: string }>;
  },
});

function Profile({ id }: { id: string }) {
  const user = readData(userResource, id);

  return (
    <button events={[on("click", () => void refreshData(userResource, id))]}>
      {user.name}
    </button>
  );
}

createRoot(document.getElementById("root")!).render(
  <Suspense fallback={<span>Loading</span>}>
    <Profile id="one" />
  </Suspense>,
);
```

`readData(resource, ...args)` is render-only. It returns fulfilled values,
throws pending loads to `Suspense`, and throws failed initial loads to
`ErrorBoundary`.

### Keys

Every resource has a key function. Keys must be arrays whose first item is a
string namespace:

```ts
key: (id: string, locale: string) => ["user", id, { locale }];
```

Key values may contain strings, finite numbers, booleans, `null`, arrays, and
plain objects. Object keys are canonicalized in sorted order. `undefined`,
`NaN`, infinities, functions, symbols, dates, maps, sets, promises, class
instances, and cycles are invalid.

The key is the whole cache identity. Fig uses the canonical key for reads,
dedupe, invalidation, refresh, SSR serialization, hydration, diagnostics, and
DevTools.

### Refresh And Invalidate

`invalidateData(resource, ...args)` marks an existing entry stale. If the key is
currently observed, Fig schedules the readers; the next read keeps showing the
last fulfilled value and starts a background reload. If nobody is observing the
key, invalidation is lazy and does not fetch.

`invalidateDataKey(key)` applies the same stale/reset semantics to one exact
structured key. `invalidateDataError(error)` invalidates every exact key Fig
attributed to a caught data error and returns whether any data keys were found.
Use it from an `ErrorBoundary` fallback before remounting or resetting the
boundary.

`invalidateDataPrefix(prefix)` marks every existing entry whose structured key
starts with `prefix` stale. For example, `invalidateDataPrefix(["user"])`
targets entries like `["user", id]`. Prefix matching uses the same canonical
key encoder as normal reads, so delimiter-shaped strings do not collide.

`refreshData(resource, ...args)` fetches immediately and resolves with a result
instead of rejecting:

```ts
const result = await refreshData(userResource, "one");

if (result.status === "fulfilled") {
  console.log(result.value);
}
```

Result statuses are `fulfilled`, `rejected`, `aborted`, and `unsupported`.
Refresh failures preserve the last fulfilled value when one exists, so visible
UI does not fall back to Suspense or an error boundary just because a refresh
failed.

### Root Store Scope

Fig installs the current root data store while rendering and while running
Fig-managed callbacks such as delegated event handlers. Outside those scopes,
bind the store explicitly:

```ts
const root = createRoot(container);

socket.on("user:update", (id) => {
  root.data.run(() => invalidateData(userResource, id));
});
```

`root.data.run(fn)` is synchronous. If you need to invalidate after an `await`,
keep the handle and re-enter:

```ts
const data = root.data;
await save();
data.run(() => refreshData(userResource, "one"));
```

Client roots accept `dataPartition` and `initialData` options. The partition
separates a store's internal keyspace without changing public resource keys.
Loaders receive only their resource arguments plus `{ signal }`; app services,
request cookies, and auth state belong in the surrounding adapter or closure,
not in the data store.

### Server Values And Hydration

Server renderers expose fulfilled data entries with `getData()`. Pass those
entries to the client root as `initialData` to hydrate by key.

For server-only data, split the browser-safe key resource from the server
loader:

```ts
import { dataResource } from "@bgub/fig";
import { serverDataResource } from "@bgub/fig/server";

export const userKey = (id: string) => ["user", id];

export const userResource = dataResource<[string], User>({
  key: userKey,
});

export const userServerResource = serverDataResource({
  key: userKey,
  load: async (id, { signal }) => fetchUser(id, signal),
});
```

Client code imports the loader-less resource. If the server streamed a value
for the same key, the client can read it as a hydrate-only entry. Since the
resource has no client loader, `refreshData(userResource, id)` resolves with
`{ status: "unsupported", reason: "no-client-loader" }`; revalidation needs a
payload or framework refresh path.

Browser bundles need the `figData` transform from `@bgub/fig-vite` so imports of
`.server.ts(x)` modules become loader-free client stubs instead of bundling the
server loader. Fig Start includes this transform automatically.

Direct client refreshes of server data are a framework feature, not a core
data one: an endpoint has to exist to serve them. Fig Start provides
`remoteDataResource` (from `@bgub/fig-start/server`), whose browser import
compiles into a plain `dataResource` with a loader that calls the framework
data endpoint. Without a framework, define an isomorphic `dataResource` whose
loader fetches an endpoint you own. Server route payload navigations do not
make an extra data request either way — data read during the payload render
streams in that same payload response.

### Activity, Errors, And DevTools

Data-resource subscriptions are committed even inside hidden `Activity` trees.
Invalidating a hidden-only key schedules offscreen prerender work and keeps the
DOM hidden.

Initial load errors are keyed. `ErrorBoundary` reports the failed keys on
`info.dataResourceKeys`; reset flows can call `invalidateDataError(error)` or
refresh/invalidate those keys before remounting or changing the boundary key.

Fig DevTools root snapshots include data-resource entries with their normalized
keys, statuses, stale state, subscriber counts, current values, and errors. The
in-page DevTools exposes them in the `Data` tab.

## License

MIT
