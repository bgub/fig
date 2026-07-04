# @bgub/fig-data

Key-addressable async data resources for Fig.

Data resources are render-time inputs with stable keys. Fig dedupes loads by
key, wires missing values to `Suspense`, tracks committed readers, and lets
applications invalidate or refresh specific entries.

## Basic Usage

```tsx
import { Suspense } from "@bgub/fig";
import { createRoot, on } from "@bgub/fig-dom";
import { dataResource, readData, refreshData } from "@bgub/fig-data";

const userResource = dataResource({
  name: "User",
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

## Keys

Every resource has a key function. Keys must be arrays whose first item is a
string namespace:

```ts
key: (id: string, locale: string) => ["user", id, { locale }];
```

Key values may contain strings, finite numbers, booleans, `null`, arrays, and
plain objects. Object keys are canonicalized in sorted order. `undefined`,
`NaN`, infinities, functions, symbols, dates, maps, sets, promises, class
instances, and cycles are invalid.

The key is the whole identity. The resource `name` is only for diagnostics and
DevTools.

## Refresh And Invalidate

`invalidateData(resource, ...args)` marks an existing entry stale. If the key is
currently observed, Fig schedules the readers; the next read keeps showing the
last fulfilled value and starts a background reload. If nobody is observing the
key, invalidation is lazy and does not fetch.

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

## Root Store Scope

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

Client roots accept `dataContext`, `dataPartition`, and `initialData` options.
The context is passed to every loader in that store; the partition separates a
store's internal keyspace without changing public resource keys.

Apps can register the data context type once so loaders do not need a third
generic parameter:

```ts
declare namespace FigData {
  interface Register {
    context: { db: DbClient };
  }
}
```

After registration, `context` in resource loaders is typed as that app context
by default:

```ts
const userResource = dataResource({
  key: (id: string) => ["user", id],
  load: (id, { context }) => context.db.user.find(id),
});
```

## Server Values And Hydration

Server renderers expose fulfilled data entries with `getData()`. Pass those
entries to the client root as `initialData` to hydrate by key.

For server-only data, split the serializable key identity from the server
loader:

```ts
export const userIdentity = dataResource.identity<[string], User>({
  name: "User",
  key: (id) => ["user", id],
});

export const userResource = dataResource.server(userIdentity, {
  load: async (id, { context }) => context.db.user.find(id),
});
```

Client code imports the identity. If the server streamed a value for the same
key, the client can read it as a hydrate-only entry. Since the identity has no
client loader, `refreshData(userIdentity, id)` resolves with
`{ status: "unsupported", reason: "no-client-loader" }`; revalidation needs an
payload or framework refresh path.

## Activity, Errors, And DevTools

Data-resource subscriptions are committed even inside hidden `Activity` trees.
Invalidating a hidden-only key schedules offscreen prerender work and keeps the
DOM hidden.

Initial load errors are keyed. `ErrorBoundary` reports the failed keys on
`info.dataResourceKeys`; reset flows should refresh or invalidate those keys
before remounting or changing the boundary key.

Fig DevTools root snapshots include data-resource entries with their normalized
keys, names, statuses, stale state, subscriber counts, current values, and
errors. The in-page DevTools exposes them in the `Data` tab.
