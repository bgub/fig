# @bgub/fig-tanstack-start

The TanStack Start runtime adapter for Fig. TanStack owns requests and route loading; Fig owns rendering, data resources, asset resources, and the single data store used by loaders and components.

```bash
pnpm add @bgub/fig-tanstack-start @bgub/fig-tanstack-router
```

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

Server entry:

```ts
import { createStartHandler } from "@tanstack/start-server-core";
import { defaultStreamHandler } from "@bgub/fig-tanstack-start/server";

export const fetch = createStartHandler(defaultStreamHandler);
```

Client entry:

```ts
import { hydrateStart } from "@bgub/fig-tanstack-start/client";

await hydrateStart();
```

`StartData` serializes the Fig store into the document with Fig's value codec. Because it appears before `Scripts`, client router creation decodes it before TanStack hydration can start route loaders; `hydrateStart` repeats that step idempotently as a fallback before `hydrateRoot` adopts the same client store. The first `readData` therefore hits the hydrated entry without re-running its loader, and `invalidateData` operates directly on the live root store.

The Start runtime is implemented. A first-class Vite plugin still requires TanStack's plugin core to admit framework adapters beyond its current React, Solid, and Vue union.
