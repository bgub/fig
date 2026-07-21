# @bgub/fig-tanstack-router

The Fig framework adapter for TanStack Router. Route matching, loaders,
navigation, and history come from `@tanstack/router-core`; this package adds
the Fig components, hooks, native links, asset mapping, and reactive store
bridge used by TanStack Start.

Generated file routes are the recommended interface. Code-created route trees
remain supported for standalone use, but they are not the design center.

## Installation

```bash
pnpm add @bgub/fig-tanstack-router @bgub/fig @bgub/fig-dom @tanstack/router-core
```

For TanStack Start, also install `@bgub/fig-tanstack-start` and use its Vite
plugin and default entries. See the
[`@bgub/fig-tanstack-start` guide](../fig-tanstack-start/README.md) for the
complete build and hydration setup.

## Recommended: generated file routes

TanStack Start generates `routeTree.gen.ts` from the files under `src/routes`.
Create one router and one root-neutral Fig data store around that generated
tree:

```tsx
// src/router.tsx
import { createStartDataContext } from "@bgub/fig-tanstack-start";
import { createRouter } from "@bgub/fig-tanstack-router";
import { routeTree } from "./routeTree.gen.ts";

export function getRouter() {
  return createRouter({
    ...createStartDataContext(),
    isServer: typeof document === "undefined",
    routeTree,
  });
}

export type AppRouter = ReturnType<typeof getRouter>;

declare module "@tanstack/router-core" {
  interface Register {
    router: AppRouter;
  }
}
```

A route file exports the generated route's configuration and receives bound,
fully typed hooks from that route:

```tsx
// src/routes/users.$id.tsx
import { on } from "@bgub/fig-dom";
import { createFileRoute } from "@tanstack/solid-router";

export const Route = createFileRoute("/users/$id")({
  validateSearch: (search): { preview?: boolean } => ({
    preview: search.preview === true,
  }),
  loaderDeps: ({ search }) => ({ preview: search.preview === true }),
  component: User,
});

function User() {
  const { id } = Route.useParams();
  const { preview } = Route.useLoaderDeps();
  const navigate = Route.useNavigate();

  return (
    <article>
      <Route.Link to="/">Home</Route.Link>
      <button mix={on("click", () => navigate({ to: "/" }))} type="button">
        Done
      </button>
      <p>{preview ? `Previewing ${id}` : `User ${id}`}</p>
    </article>
  );
}
```

`@tanstack/solid-router` is currently a compiler-only compatibility ID. The
Start plugin maps it directly to this package; no Solid runtime is installed
or bundled. TypeScript needs the equivalent path mapping:

```json
{
  "compilerOptions": {
    "paths": {
      "@tanstack/solid-router": ["./node_modules/@bgub/fig-tanstack-router"]
    }
  }
}
```

The root route normally renders Router-managed document state and Start's Fig
data snapshot before the bootstrap scripts:

```tsx
import { StartData, type StartDataContext } from "@bgub/fig-tanstack-start";
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
} from "@bgub/fig-tanstack-router";

export const Route = createRootRouteWithContext<StartDataContext>()({
  component: Document,
});

function Document() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <StartData />
        <Scripts />
      </body>
    </html>
  );
}
```

Route stylesheets, preload hints, preconnects, font preloads, and async scripts
are translated into Fig asset resources owned by the matched route. Title,
meta, inline styles, JSON-LD, and synchronous scripts retain their document
position. Configure manifest cross-origin behavior on the router so it is
available before the root document renders:

```tsx
const router = createRouter({
  assetCrossOrigin: { script: "anonymous", stylesheet: "use-credentials" },
  routeTree,
});
```

`getRouteApi(routeId)` provides a route-bound interface outside the route's
own module. `useMatches` reads or selects the active match list;
`useMatchRoute` and `MatchRoute` test locations reactively; `Navigate`
performs declarative post-commit navigation.

## Provider and navigation lifecycle

`RouterProvider` can merge partial router options and route context into an
existing router. Initial loaders see these values on their first run, and
later provider renders preserve context fields they do not replace:

```tsx
<RouterProvider context={{ session }} defaultPreload="intent" router={router} />
```

Browser navigation runs in a Fig transition, keeping the previously resolved
match tree visible until loading settles. Router lifecycle subscriptions fire
in commit order: `onLoad`, `onBeforeRouteMount`, `onResolved`, then
`onRendered`. The provider skips a duplicate initial load during hydration,
normalizes validated locations in browser history, and cleans up its history
and transition bindings on unmount. A superseded navigation cannot publish a
late resolved state.

Ordinary route changes do not use `Activity`: the previous tree is replaced
after the transition. Retaining inactive route trees would require a separate
keep-alive contract for their state, effects, and data ownership.

## Route data: delegate keyed values to Fig

Fig data resources are the external cache for keyed route data — TanStack's
["pass all loader events to an external cache"](https://tanstack.com/router/latest/docs/guide/data-loading#passing-all-loader-events-to-an-external-cache)
pattern. Router Core decides _when_ loaders run; the Fig store owns value
identity, deduplication, freshness, hydration, errors, and render-time reads.

`createStartDataContext()` places the Fig data handle at
`router.context.data`. A blocking route loader calls `ensureRouteData`, while
the component reads the same entry with `readData`:

```tsx
import { dataResource, readData } from "@bgub/fig";
import { ensureRouteData } from "@bgub/fig-tanstack-router";
import { createFileRoute } from "@tanstack/solid-router";

const userResource = dataResource({
  key: (id: string) => ["user", id],
  load: async (id, { signal }) => fetchUser(id, signal),
});

export const Route = createFileRoute("/users/$id")({
  loader: ({ context, params }) =>
    ensureRouteData(context, userResource, params.id),
  component: User,
});

function User() {
  const { id } = Route.useParams();
  const user = readData(userResource, id);
  return <h1>{user.name}</h1>;
}
```

`ensureRouteData` deliberately resolves to `void`, so Router Core does not
retain a second copy in `loaderData`. For non-blocking streaming, call
`context.data.preloadData(resource, ...args)` and return; the component's
`readData` suspends through Fig until the entry settles.

`loaderData` is still appropriate for small, navigation-scoped orchestration
values that do not need their own cache identity or freshness lifecycle. Use a
data resource when a value is keyed, shared, hydrated, independently
invalidated, refreshed, or streamed.

## Support policy

| Tier                 | Contract                                                                                                                                                                                                                                                                                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guaranteed           | Generated file and lazy routes; typed route APIs and selectors; Router creation/provider; native links and navigation; loaders, redirects, not-found and route errors; pending timing and remount dependencies; route-level Start SSR policies/hydration; scroll restoration; head and script output; search/history helpers; Fig data-resource delegation. |
| Compatibility        | `createRootRoute` and `createRoute` for code-created route trees. These use the same Router Core machinery but are not the recommended Start authoring path.                                                                                                                                                                                                |
| Deferred             | Blockers/back navigation hooks, element-scroll helpers, parent/child match selectors, and uncommon link conveniences such as proximity preloading.                                                                                                                                                                                                          |
| Deliberately omitted | Additional deprecated compatibility classes and aliases; public `Await`, `ClientOnly`, `CatchBoundary`, and `ScrollRestoration` clones; Activity-based keep-alive routing. Fig primitives or internal adapter behavior cover these concerns.                                                                                                                |

The adapter is pinned and tested against `@tanstack/router-core@1.171.15`.
Upgrades are conformance changes: generated-route, navigation, SSR, data, and
document tests must pass against the new version before the pin moves.

## Native link contract

`Link` renders a native anchor. It intercepts only unmodified primary clicks;
downloads, external URLs, modifier keys, and non-`_self` targets retain native
browser behavior. Disabled links omit `href` and expose `aria-disabled`.
Preloading supports `intent`, `render`, and `viewport`, and active links expose
`aria-current="page"` plus `data-status="active"`.

## Code-created route trees

Standalone applications may still assemble a tree with `createRootRoute`,
`createRoute`, and `route.addChildren`. This compatibility surface remains
tested because it is useful for small routers and focused adapter tests. New
TanStack Start applications should use generated file routes so the generator
can provide route typing and automatic code splitting.
