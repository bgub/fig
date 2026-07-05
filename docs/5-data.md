# Data

Fig data resources are keyed async values tied into rendering, scheduling, SSR,
and hydration. The core model is intentionally small:

- a per-root store of entries keyed by resource keys
- a render-time read verb: `readData`
- two freshness verbs: `invalidateData` and `refreshData`
- server serialization of fulfilled entries

The point is not to replace every feature of a query library. Fig owns the
parts that need renderer cooperation: committed subscriptions, cancellation,
scheduling, error attribution, and the server-to-client handoff.

## Resources

Define a resource with `dataResource`:

```ts
import { dataResource } from "@bgub/fig-data";

export const userResource = dataResource({
  name: "User",
  key: (id: string) => ["user", id],
  load: async (id, { context, signal }) => context.users.find(id, { signal }),
});
```

The key is the identity. There is no separate resource id for cache lookup.
`key` returns a tuple with a string namespace followed by serializable parts.
Fig canonically encodes that tuple and uses it for reads, dedupe, invalidation,
refresh, SSR serialization, and hydration.

That means all of these target the same store entry:

```ts
readData(userResource, "42");
invalidateData(userResource, "42");
refreshData(userResource, "42");
```

Keys are deliberately strict. They reject `undefined`, non-finite numbers, and
non-plain objects; normalize `-0`; and sort object keys. In development, Fig
can also fingerprint key/argument drift, where a loader depends on something
that the key forgot to include. Use `debugArgs` only for intentionally
non-serializable arguments.

## Reads

`readData(resource, ...args)` is a render-time read:

1. Fig computes the resource key.
2. If the entry is fulfilled, `readData` returns the value synchronously.
3. If the entry is missing, Fig creates a pending entry, starts `load`, and
   suspends by throwing the pending promise.
4. When the load settles, Fig schedules subscribed owners to render again.
5. On retry, the same key hits the fulfilled entry and returns the value.

Multiple components reading the same key share one entry and one in-flight
load. A rejected load settles into the entry; the retry render throws the real
error from the read site, so normal `ErrorBoundary` handling applies.

Subscriptions are commit-aware. A render attempt may be abandoned because it
suspended, errored, was interrupted, or was only a dev shadow pass. Fig records
tentative data reads during render and commits them only if that render becomes
real UI. On unmount, subscriptions are released; a value-less pending load with
no remaining owners can be aborted.

Use `preloadData(resource, ...args)` to start a load without subscribing. This
is useful from event handlers before navigation. Unclaimed preloads and
inactive fulfilled entries are retained only for bounded windows.

## Freshness

There are two freshness verbs:

- `invalidateData(resource, ...args)` marks an entry stale. The next read
  reloads lazily. It also clears a cached rejection so a remounted boundary can
  retry.
- `refreshData(resource, ...args)` fetches immediately. It never rejects; it
  resolves to a result object.

`refreshData` result statuses are:

```ts
type DataRefreshResult<T> =
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; error: unknown; staleValue?: T }
  | {
      status: "aborted";
      reason: "superseded" | "store-disposed" | "evicted";
      staleValue?: T;
    }
  | {
      status: "unsupported";
      reason: "no-client-loader" | "no-remote-fetcher";
      staleValue?: T;
    };
```

A failed refresh keeps the stale value visible and records the refresh error.
Reads do not keep auto-retrying a persistently failing refresh. A later explicit
invalidate or refresh re-arms the entry.

Loads are generation-guarded. If a newer load supersedes an older one, the old
settlement is ignored. Loaders receive an `AbortSignal` and should pass it
through to the underlying work.

## Stores And Handles

Every root owns a data store. Server renders get a fresh store per request.
There is no process-global data cache.

The free functions `invalidateData`, `preloadData`, and `refreshData` use an
ambient store. That ambient store exists only while Fig is executing
synchronously: render, event dispatch, the synchronous prefix of actions and
transitions, and effects. After an `await`, capture an explicit handle first:

```ts
import { readDataStore } from "@bgub/fig-data";

function RefreshButton() {
  const data = readDataStore();

  return (
    <button
      events={[
        on("click", async () => {
          await doSomethingElse();
          await data.refreshData(userResource, "42");
        }),
      ]}
    >
      Refresh
    </button>
  );
}
```

You can also use `root.data` from a created root. The explicit handle exposes
the same operations plus `hydrate(entries)` and `run(callback)`.

## SSR Handoff

During SSR, the server render uses a request-local data store:

1. A component calls `readData(userResource, "42")`.
2. The load starts and the component suspends.
3. The load resolves, the component re-renders, and HTML streams.
4. The renderer exposes fulfilled entries, for example
   `[{ key: ["user", "42"], value: user }]`.
5. The app serializes those entries with the document or payload stream.
6. The client root hydrates them before the first client render.
7. The client computes the same key and reads the fulfilled value
   synchronously.

This is why the key is the identity. The server and client do not need to
negotiate a separate request id. The handoff is just map rows.

For document SSR, pass the collected entries to the client root:

```ts
const result = renderToStream(<App />);
await result.allReady;

const entries = result.getData();
```

```ts
hydrateRoot(container, <App />, {
  initialData: entries,
});
```

Payload navigation has the same rule: data read while rendering a server route
segment streams in the same payload response as the route. It does not need a
second data request.

## Server-Only Data

Sometimes the loader can only run on the server because it imports a database,
filesystem, private SDK, or request-only secret. Do not put that loader in a
shared module.

Instead, split the browser-safe key handle from the server loader:

```ts
// user-data.ts
import { dataResource } from "@bgub/fig-data";

export const userKey = (id: string) => ["user", id] as const;

export const userResource = dataResource({
  name: "User",
  key: userKey,
});
```

```ts
// user-data.server.ts
import { serverDataResource } from "@bgub/fig-data/server";
import { userKey } from "./user-data.ts";

export const userServerResource = serverDataResource({
  name: "User",
  key: userKey,
  load: async (id, { context, signal }) => context.users.find(id, { signal }),
});
```

Browser components import and read `userResource`. Server code imports and
preloads or reads `userServerResource`. Because both resources return the same
key, they address the same store entry.

On the client, the loader-less resource is hydrate-only. If the server streamed
a value for that key, `readData(userResource, id)` can read it. If the client
tries to refresh it directly, the result is:

```ts
{ status: "unsupported", reason: "no-client-loader" }
```

Fresh data for hydrate-only resources must come through a server render,
payload refresh, or a manually built endpoint that hydrates new entries.

## Remote Server Data

A server resource can opt into direct client refreshes:

```ts
// user-data.server.ts
import { serverDataResource } from "@bgub/fig-data/server";

export const userResource = serverDataResource({
  name: "User",
  remote: true,
  key: (id: string) => ["user", id],
  load: async (id, { context, signal }) => context.users.find(id, { signal }),
});
```

`remote: true` is explicit for security. Without it, the resource is
server-only and no direct data endpoint should be generated.

In Fig Start, a browser import of a `remote: true` server resource becomes a
generated `dataResource.remote(...)` stub. The real server resource is
registered behind the data endpoint. Reads still prefer hydrated values; cache
misses and explicit refreshes call the endpoint through the root's
`dataRemoteFetch` transport.

If a remote stub is used without a remote fetcher, refresh resolves with:

```ts
{ status: "unsupported", reason: "no-remote-fetcher" }
```

Payload navigations are separate. If the new route reads server data while
rendering its payload, that data should stream in the payload response itself,
not through an extra remote data request.

## Context

Loaders receive `{ signal, context }`. Register the app-wide context type once:

```ts
declare global {
  namespace FigData {
    interface Register {
      context: {
        users: UserService;
      };
    }
  }
}
```

The value comes from root options on the client and per-request render options
on the server. This keeps resources typed without threading a generic context
through every call site.

## Errors

Errors thrown through `readData` are tagged with the failed data keys. An
`ErrorBoundary` can inspect `ErrorInfo.dataResourceKeys` and show a targeted
retry UI.

A common retry flow is:

1. invalidate or refresh the failed key
2. reset/remount the boundary

The stored error is not mutated. Fig keeps attribution in a side table, so
ordinary error objects remain ordinary error objects.

## Why This Is In Fig

Most cache mechanics could be userland: maps, dedupe, retention timers, thrown
promises, and even the two freshness verbs. The part that needs Fig is the
render lifecycle.

Fig can tell the difference between:

- a component that read a key during an abandoned render attempt
- a component that read a key and actually committed
- a component that used to read a key but no longer does
- a component that unmounted

That distinction matters for cancellation, stale dependency cleanup, and
scheduling. A refresh started inside a transition should schedule transition
work for subscribed owners, not force every subscriber through a synchronous
external-store update.

The server story also needs renderer cooperation. The server store is scoped to
the render request, fulfilled entries are serialized alongside the HTML or
payload that needed them, and the client hydrates those entries before its
first read.

Fig keeps the surface narrow. It does not absorb polling, focus refetch,
retry policies, optimistic updates, pagination, or mutation state machines.
Those compose in userland from resources, the two freshness verbs, and
`AbortSignal`.

The through-line is simple: make the key the only cache identity, let reads
subscribe through the renderer, and let SSR hand off fulfilled map rows by key.
