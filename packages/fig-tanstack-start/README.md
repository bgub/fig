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
framework target. The generator currently normalizes file-route constructor
imports to its Solid package ID; the plugin maps that ID directly to Fig, and no
Solid runtime is installed or bundled. TypeScript needs the corresponding
compiler-only `paths` entry:

```json
{
  "compilerOptions": {
    "paths": {
      "@tanstack/solid-router": ["./node_modules/@bgub/fig-tanstack-router"],
      "@tanstack/solid-start": ["./node_modules/@bgub/fig-tanstack-start"]
    }
  }
}
```

The Start mapping lets the generated registration footer carry middleware
context types from a conventional `src/start.ts` into `createServerFn`.

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

## Request and function middleware

The package root also exports TanStack's `createStart`, `createMiddleware`, and
`createCsrfMiddleware`. A conventional `src/start.ts` configures global request
and server-function middleware:

```ts
import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from "@bgub/fig-tanstack-start";

const requestContext = createMiddleware({ type: "request" }).server(
  ({ request, next }) =>
    next({ context: { requestId: request.headers.get("x-request-id") } }),
);

export const startInstance = createStart(() => ({
  requestMiddleware: [
    requestContext,
    createCsrfMiddleware({
      filter: (context) => context.handlerType === "serverFn",
    }),
  ],
}));
```

Start's global async context remains request-local across interleaved SSR and
server-function work. Redirects thrown by generated route loaders or
`beforeLoad` use Router Core's normal server and client redirect handling.

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
adapter through Vite's production client and SSR builds: generated and lazy
file routes, streamed SSR, Router dehydration, Fig-owned data serialization,
full-document hydration, middleware isolation, redirects, a compiled server
mutation, and live data-resource invalidation all run through public adapter
entries.
