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

`StartData` serializes the Fig store into the server document with Fig's value codec, then renders nothing in the browser. Because it appears before `Scripts`, client router creation decodes it before TanStack hydration can start route loaders; `hydrateStart` repeats that step idempotently as a fallback before `hydrateRoot` adopts the same client store. The first `readData` therefore hits the hydrated entry without re-running its loader, and `invalidateData` operates directly on the live root store.

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

## Payload routes

Payload routes keep server-only component trees out of the client bundle while
using the same Fig data store as ordinary route data. Serve the tree from a raw
TanStack server-function response:

```tsx
import { createServerFn } from "@bgub/fig-tanstack-start";
import { renderPayloadResponse } from "@bgub/fig-tanstack-start/server";
import { Profile } from "./profile.server.tsx";

export const getProfile = createServerFn({ method: "GET" })
  .validator((input: { id: string }) => input)
  .handler(({ data }) => renderPayloadResponse(<Profile id={data.id} />));
```

Adapt that response into a keyed Payload data resource. A shared stateful
resolver keeps interactive client-reference islands mounted across re-decodes:

```ts
import { createPayloadClientReferenceResolver } from "@bgub/fig/payload";
import { payloadResource } from "@bgub/fig-tanstack-start/payload";
import { getProfile } from "./profile-function.tsx";

const resolveClientReference = createPayloadClientReferenceResolver(
  (reference) =>
    reference.id === "src/LikeButton.tsx#LikeButton"
      ? import("./LikeButton.tsx").then((module) => module.LikeButton)
      : undefined,
);

export const profilePayload = payloadResource<{ id: string }>({
  key: ({ id }) => ["profile-payload", id],
  request: (input, { signal }) => getProfile({ data: input, signal }),
  resolveClientReference,
});
```

The route uses the same loader/read split as any other data resource:

```tsx
import { readData } from "@bgub/fig";
import { ensureRouteData } from "@bgub/fig-tanstack-router";
import { createFileRoute } from "@tanstack/solid-router";
import { profilePayload } from "../profile-payload.ts";

export const Route = createFileRoute("/profiles/$id")({
  loader: ({ context, params }) =>
    ensureRouteData(context, profilePayload, { id: params.id }),
  component: ProfileRoute,
});

function ProfileRoute() {
  const { id } = Route.useParams();
  return readData(profilePayload, { id });
}
```

On SSR, Fig decodes and renders the root once, retains Payload-discovered asset
resources on the rows that declared them, and embeds the response bytes for
hydration. The document renderer emits each asset before its dependent HTML
segment, including streamed Suspense holes. The browser adopts the embedded
bytes without a second server-function call. Shell HTML streams while Suspense
holes settle; TanStack starts full-document hydration after each complete
initial Payload response is embedded in a keyed carrier. Client navigation and
refresh use the same raw response path.

The Vite adapter emits assets imported only by server modules and copies those
files into the client output, so `stylesheet(styleUrl)` may use a CSS `?url`
import from a server-only Payload component in both development and production.

The [`demo-tanstack-start`](../../apps/demo-tanstack-start) app exercises the
adapter through Vite's production client and SSR builds: generated and split
file routes, streamed SSR, Router dehydration, Fig-owned data serialization,
full-document hydration, request-derived themes, view transitions, live
data-resource invalidation, nested routes, and server-only post and asset trees
all run through public adapter entries. The asset route embeds two independent
Payload resources and hydrates an interactive client-reference island whose
CSS and SVG are emitted through the production builds.
