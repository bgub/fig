# @bgub/fig-tanstack-start

The TanStack Start adapter for Fig. TanStack owns builds, requests, route
loading, redirects, and server-function transport; Fig owns rendering, data
resources, asset resources, and the single data store used by loaders and
components.

```bash
pnpm add @bgub/fig-tanstack-start @bgub/fig-tanstack-router
```

Add the adapter to Vite:

```ts
import { tanstackStart } from "@bgub/fig-tanstack-start/plugin/vite";

const plugins = [tanstackStart()];
```

The plugin supplies the default client and server entries, including streamed
Fig SSR and full-document hydration. It currently uses TanStack's Solid target
as a private compiler compatibility layer because plugin core has no custom
framework target. Applications import only `@bgub/fig-*`; no Solid runtime is
installed or bundled.

Create the router with a root-neutral Fig store:

```tsx
import { createStartDataContext } from "@bgub/fig-tanstack-start";
import {
  createRouter,
  createRootRouteWithContext,
} from "@bgub/fig-tanstack-router";

const startData = createStartDataContext();
const rootRoute = createRootRouteWithContext<typeof startData.context>()({
  component: Document,
});

export const router = createRouter({
  ...startData,
  routeTree: rootRoute,
});
```

The root document renders route-managed assets, Fig data, and TanStack's scripts in that order:

```tsx
import { StartData } from "@bgub/fig-tanstack-start";
import { HeadContent, Outlet, Scripts } from "@bgub/fig-tanstack-router";

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

`StartData` serializes the Fig store into the document with Fig's value codec. Because it appears before `Scripts`, client router creation decodes it before TanStack hydration can start route loaders; `hydrateStart` repeats that step idempotently as a fallback before `hydrateRoot` adopts the same client store. The first `readData` therefore hits the hydrated entry without re-running its loader, and `invalidateData` operates directly on the live root store.

## Server functions

The package root exports TanStack's `createServerFn`. The Vite plugin compiles
the handler into the server build and the browser call into an RPC request:

```ts
import { createServerFn } from "@bgub/fig-tanstack-start";

export const renameUser = createServerFn({ method: "POST" })
  .validator((input: { id: string; name: string }) => input)
  .handler(async ({ data }) => {
    await database.users.rename(data.id, data.name);
  });
```

An async event must capture the Fig store before its first `await` when it
needs to refresh data afterward:

```ts
import { readDataStore } from "@bgub/fig";

const data = readDataStore();
await renameUser({ data: { id, name }, signal });
data.invalidateData(userResource, id);
```

The [`demo-tanstack-start`](../../apps/demo-tanstack-start) app exercises the
adapter through Vite's production client and SSR builds: streamed SSR, Router
dehydration, Fig-owned data serialization, full-document hydration, a compiled
server mutation, and live data-resource invalidation all run through public
adapter entries.
