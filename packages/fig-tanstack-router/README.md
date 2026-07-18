# @bgub/fig-tanstack-router

The Fig framework adapter for TanStack Router. Route matching, loaders,
navigation, and history come from `@tanstack/router-core`; this package adds
Fig components, hooks, native links, and the reactive store bridge.

## Installation

```bash
pnpm add @bgub/fig-tanstack-router @bgub/fig @bgub/fig-dom @tanstack/router-core
```

## Usage

```tsx
import { createRoot } from "@bgub/fig-dom";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
} from "@bgub/fig-tanstack-router";

const rootRoute = createRootRoute({
  component: () => (
    <main>
      <Link to="/">Home</Link>
      <Outlet />
    </main>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => <h1>Home</h1>,
});

const routeTree = rootRoute.addChildren([indexRoute]);
const router = createRouter({ routeTree });

declare module "@tanstack/router-core" {
  interface Register {
    router: typeof router;
  }
}

const container = document.getElementById("root");
if (container === null) throw new Error("Missing root.");

createRoot(container).render(<RouterProvider router={router} />);
```

`Link` renders a native anchor. It only intercepts unmodified primary clicks;
downloads, external URLs, modifier keys, and non-`_self` targets keep their
browser behavior. Preloading supports `intent`, `render`, and `viewport`.
Pass `{ from: routeId }` to the params, search, loader-data, or route-context
hook to target an active route and infer its value from the registered tree.

## Route data: delegate to data resources

Fig data resources are the external cache for route data — TanStack's
["pass all loader events to an external cache"](https://tanstack.com/router/latest/docs/guide/data-loading#passing-all-loader-events-to-an-external-cache)
pattern, in the role TanStack Query plays for React. The router decides _when_
loaders run (navigation, intent/viewport preloads, `router.invalidate()`);
the data store owns identity, dedup, freshness, and reads.

Two pieces of wiring:

1. Put the root's data handle in router context. `root.data` is a lazy
   handle, so it can enter context before the first render. The adapter then
   defaults `defaultPreloadStaleTime` to `0`, ensuring every preload event
   reaches the external cache; an explicit router option still wins.
2. Loaders return `ensureRouteData(...)`; components read the same resource
   with `readData`.

```tsx
import { dataResource, readData } from "@bgub/fig";
import { createRoot } from "@bgub/fig-dom";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  ensureRouteData,
  type RouteDataContext,
  RouterProvider,
  useParams,
} from "@bgub/fig-tanstack-router";

const userResource = dataResource({
  key: (id: string) => ["user", id],
  load: async (id, { signal }) => fetchUser(id, signal),
});

const rootRoute = createRootRouteWithContext<RouteDataContext>()({
  component: Layout,
});

const userRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "users/$id",
  loader: ({ context, params }) =>
    ensureRouteData(context, userResource, params.id),
  component: function User() {
    const { id } = useParams({ from: "/users/$id" });
    const user = readData(userResource, id);
    return <h1>{user.name}</h1>;
  },
});

const routeTree = rootRoute.addChildren([userRoute]);
const root = createRoot(container);
const router = createRouter({
  routeTree,
  context: { data: root.data },
});
root.render(<RouterProvider router={router} />);
```

The loader's `ensureRouteData` and the component's `readData` share one store
entry, so navigation commits with the data already cached and `Link` preloads
warm the same entry the component reads. The helper deliberately resolves to
`void`, preventing TanStack Router from also retaining the value as
`loaderData`.

Freshness lives in the store, not the router: `invalidateData(userResource,
id)` re-renders every subscribed route component with the revalidated value —
no `router.invalidate()` needed. (`router.invalidate()` still composes: it
re-runs loaders, which hit the cache.) Route error `reset()` first invalidates
any Fig data keys attributed to the caught error, then re-runs the router.

For streaming instead of blocking, have the loader call
`context.data.preloadData(resource, ...args)` and return; `readData` then
suspends into the route's `pendingComponent` until the entry settles.

## Generated file routes

The adapter implements the route-generator surface used by TanStack Start:
`createFileRoute`, `createLazyFileRoute`, `lazyRouteComponent`, and `lazyFn`.
Generated route trees therefore use the same Fig route objects as code-defined
trees, including typed params, loaders, head entries, lazy chunks, redirects,
and route error/not-found components.

TanStack's generator still hard-codes its closed framework target when it
normalizes constructor imports. Until it accepts a native Fig target, the Start
plugin maps the generated `@tanstack/solid-router` compatibility ID directly to
this package. Add the equivalent compiler-only mapping to the application's
`tsconfig.json`:

```json
{
  "compilerOptions": {
    "paths": {
      "@tanstack/solid-router": ["./node_modules/@bgub/fig-tanstack-router"]
    }
  }
}
```

No Solid runtime is installed or bundled. Application components, hooks, links,
router construction, and generated route behavior remain Fig APIs.
