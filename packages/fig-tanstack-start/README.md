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
Fig SSR, full-document hydration, and state-preserving Fig Fast Refresh. It
currently uses TanStack's Solid target
as a private compiler compatibility layer because plugin core has no custom
framework target. The generator currently normalizes file-route constructor
imports to its Solid package ID; the plugin maps that ID directly to Fig, and no
Solid Router or Start adapter runtime is installed or bundled. TypeScript needs the corresponding
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

The root document renders route-managed assets followed by Start's combined Fig data and TanStack script transport:

```tsx
import { StartScripts } from "@bgub/fig-tanstack-start";
import { HeadContent, Outlet } from "@bgub/fig-tanstack-router";

function Document() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <StartScripts />
      </body>
    </html>
  );
}
```

`StartScripts` serializes the Fig store into the server document with Fig's value codec, establishes the adapter's Payload insertion point, and then renders TanStack's bootstrap scripts. Client router creation decodes the data before TanStack hydration can start route loaders; `hydrateStart` repeats that step idempotently as a fallback before `hydrateRoot` adopts the same client store. The first `readData` therefore hits the hydrated entry without re-running its loader, and `invalidateData` operates directly on the live root store.

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

Payload routes keep Payload-rendered component trees out of the client bundle
while using the same Fig data store as ordinary route data. The smallest route
is one colocated declaration:

```tsx
// profile.payload.tsx
import { payloadResource } from "@bgub/fig-tanstack-start/payload";

export const profilePayload = payloadResource<string>({
  key: (id) => ["profile-payload", id],
  render: (id) => <article>Profile: {id}</article>,
});
```

`render` must be an inline function; it is the semantic boundary that the
compiler extracts into a private server function. It may be async. The browser
bundle keeps the resource key, cache, and RPC stub; it omits the callback's JSX
and imports used only by the callback. Keep the resource declaration in a
client-importable module such as `.payload.tsx` because the route imports the
resource handle.

When the tree grows, the callback can import ordinary components. Those imports
also stay out of the browser bundle when only the callback uses them. A filename
does not cause a component to render through Payload—the `render` callback does.
Applications do not call `createServerFn` or `renderPayloadResponse` for Payload
resources.

Mark the exceptional SSR-plus-hydration boundary with `Isomorphic` and an
ordinary static component import. For example, a separate Payload component can
contain the boundary:

```tsx
import type { FigNode } from "@bgub/fig";
import { Isomorphic } from "@bgub/fig-tanstack-start/payload";
import { LikeButton } from "./LikeButton.tsx";

export function Profile({ id }: { id: string }): FigNode {
  return <Isomorphic component={LikeButton} userId={id} />;
}
```

The Vite plugin replaces only the `component` prop with an opaque Payload
reference and generates its server/browser module resolver. The component
remains an ordinary export and can render through Payload elsewhere without
the boundary. `component` must be a named or default static import.
Applications do not use a `.client.tsx` suffix, `clientReference`,
`createPayloadClientReferenceResolver`, reference ids, or dynamic imports.

The route uses the same loader/read split as any other data resource:

```tsx
import { readData } from "@bgub/fig";
import { ensureRouteData } from "@bgub/fig-tanstack-router";
import { createFileRoute } from "@tanstack/solid-router";
import { profilePayload } from "../profile.payload.tsx";

export const Route = createFileRoute("/profiles/$id")({
  loader: ({ context, params }) =>
    ensureRouteData(context, profilePayload, params.id),
  component: ProfileRoute,
});

function ProfileRoute() {
  const { id } = Route.useParams();
  return readData(profilePayload, id);
}
```

When the route does not need the tree before commit, preload it and return
`void`; Fig Suspense then owns the pending UI and stream:

```tsx
import { Suspense } from "@bgub/fig";

export const Route = createFileRoute("/profiles/$id")({
  loader: ({ context, params }) => {
    context.data.preloadData(profilePayload, params.id);
  },
  component: () => (
    <Suspense fallback={<p>Streaming profile…</p>}>
      <ProfileRoute />
    </Suspense>
  ),
});
```

On SSR, Fig decodes and renders the root once, retains Payload-discovered asset
resources on the rows that declared them, and embeds the response bytes for
hydration. This includes Payload resources registered after the document shell
starts. The document renderer emits each asset before its dependent HTML
segment, including streamed Suspense holes. The browser adopts the embedded
bytes without a second server-function call. Shell HTML streams while Suspense
holes settle; TanStack starts full-document hydration after each complete
initial Payload response is embedded in a keyed carrier. Client navigation and
refresh use the same raw response path.

The Vite adapter follows ordinary component imports from each `payloadResource`
render callback and compiles their static stylesheet imports into Payload asset
dependencies. Import CSS normally; no manual
`assets(stylesheet(...))` wrapper or `?url` import is needed. A Payload-rendered
component's stylesheet is copied from the server build into the public client
output. An `Isomorphic` component's hashed client CSS is attached through the
generated manifest. Both use the existing Payload asset row and reveal gate
and are emitted only when their component renders.

The [`demo-tanstack-start`](../../apps/demo-tanstack-start) app exercises the
adapter through Vite's production client and SSR builds: generated and split
file routes, streamed SSR, Router dehydration, Fig-owned data serialization,
full-document hydration, request-derived themes, view transitions, live
data-resource invalidation, nested routes, and post and asset Payload trees all
run through public adapter entries. The asset route embeds two independent
Payload resources and hydrates an explicit `Isomorphic` component whose CSS and
SVG are emitted through the production builds.
