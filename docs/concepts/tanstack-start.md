# TanStack Start Adapter

Status: runtime, Vite plugin, and Payload routes implemented; native TanStack framework target pending

`@bgub/fig-tanstack-start` connects TanStack Start's request and hydration cores to Fig.

TanStack owns requests, middleware, route loading, redirects, manifests, and server-function transport. Fig owns rendering, data-resource identity, the root data store, document-data serialization, and asset resources.

## One Data Store

`createStartDataContext()` creates one Fig store before rendering begins and places it in router context.

On the server:

1. Route loaders use that handle through `ensureRouteData`.
2. `renderRouterToStream` passes the same store to `renderToDocumentStream`.
3. The renderer adopts it for the request and later disposes it.

On the client, the adapter decodes the Fig document snapshot into a fresh store before `hydrateRoot` adopts it. TanStack never copies those values into `loaderData`.

`StartScripts` appears near the end of `<body>`, after route content. It writes, in order:

1. a non-executable script containing Fig's encoded data snapshot;
2. a marker where initial Payload carriers belong; and
3. Router's normal `Scripts` output.

The data script is hydration state, not UI. It is decoded while constructing the client router, before client-only loaders can start. The client entry repeats the decode idempotently as a fallback. If the parser has not reached `StartScripts` yet, hydration waits for `DOMContentLoaded`.

The transport uses Fig's Payload value codec, including supported non-JSON values and graph identity. Inline-dangerous characters are escaped.

## Payload Routes

`createPayloadComponent({ key, load: serverPayload(render) })` makes a Payload tree directly renderable while retaining an ordinary Fig data resource as its cache machinery.

```tsx
import { createPayloadComponent } from "@bgub/fig-dom";
import { serverPayload } from "@bgub/fig-tanstack-start/payload";
import { Post } from "./Post.server.tsx";

export const PostPage = createPayloadComponent<{ id: string }>({
  key: ["post-tree"],
  load: serverPayload(Post),
});
```

A route loader calls `ensureRouteData(context, PostPage, { id })`, and the route renders `<PostPage id={id} />`. TanStack orchestrates the route; Fig owns the cache entry, streamed tree, data rows, and assets. The same component works with the ordinary data-resource freshness APIs and explicit store methods.

The compiler turns the component or callback passed to `serverPayload` into a private TanStack server function. It renders that function as the Payload root rather than calling it before rendering, so root-level data reads, hooks, and suspension use normal server-renderer semantics. Browser output keeps a compiler-marked RPC loader but removes server-only JSX and imports; without that marker, `serverPayload` throws before invoking application code. The declaration therefore stays in a client-importable module, conventionally `.payload.tsx`; the filename itself has no runtime meaning. The extracted component may come from a TanStack-protected `.server.tsx` module.

Start server functions do not expose an abort signal, so `renderPayloadResponse` uses the current request signal unless explicitly overridden. A disconnected client stops the Payload render.

During SSR, decoding registers the response as a request-local companion stream. The element-valued root is omitted from the ordinary data snapshot because it may contain component functions.

Assets remain attached to their decoded owners, allowing the document renderer to emit each one before the HTML segment that needs it.

The document transport keeps accepting companion streams after the shell starts. At the `StartScripts` marker it writes one nonce-bearing, non-executable carrier per completed response, then allows client hydration to begin. Slow nested holes do not block HTML or first paint, but they do delay hydration and interactivity.

Initial hydration reconstructs the Payload response from its carrier instead of making another request. Later navigation, invalidation, and refresh use the generated server function normally.

Payload data rows hydrate the same generation-guarded store. Browser delivery assets use normal reveal gates; metadata stays attached to its owner until commit. Request-local registration prevents concurrent requests from seeing each other's streams.

## Compiler And Vite Integration

The Vite plugin delegates environment planning, routes, server-function extraction, development serving, production builds, and preview to TanStack's plugin core. It supplies Fig's client and server entries and installs `figRefresh()`.

TanStack currently recognizes only React, Solid, and Vue framework targets. Fig's versioned compatibility profile privately uses Solid identifiers, pins the participating TanStack versions, and maps generated Router, Start, and RPC imports back to Fig packages. No Solid runtime enters the client graph.

Applications mirror the generated compatibility ids with TypeScript paths. A future native Fig target can replace this aliasing without changing runtime ownership.

The adapter shares TanStack's global `AsyncLocalStorage` key on the server so bundled copies still see one request context. Values remain request-local, including across concurrent streaming renders. Browser storage context is inert.

Server-only modules may emit assets that the browser still needs. After the server build, the adapter copies those emitted files into the client output. Conflicting bytes at one public path fail the build; custom naming should therefore use hashes or separate namespaces.

## Component Assets And `Isomorphic`

Static stylesheet imports in named components reached from a `serverPayload` render are compiled into ordinary Payload asset descriptors. Application code imports CSS normally; it does not write `assets()` calls for compiler-known styles.

Payload rendering is a use-site behavior. Every ordinary component reached from the `serverPayload` result executes through Payload, regardless of filename. A `.server.tsx` file may contain the rendered component because compiler extraction removes that import from the browser graph; the `createPayloadComponent` declaration itself remains client-importable.

`Isomorphic` is the explicit client boundary:

```tsx
<Isomorphic component={Counter} initial={3} />
```

`component` must be a static named or default import. The compiler replaces it with a client reference, generates server and browser manifest entries, and attaches the client build's CSS.

The boundary renders during document SSR and hydrates as a real client component. An ordinary `<Counter />` in the Payload tree remains server-rendered and serialized.

The generated manifest owns one stateful resolver per bundle, keeping component identity stable across decodes. Compiler analysis follows component imports from `serverPayload` and stops at `Isomorphic`. Client build output supplies final hashed asset URLs to the server manifest without a process-global registry.

## Request Context And Redirects

The package exposes Start's `createStart`, `createMiddleware`, and `createCsrfMiddleware`. Request middleware runs before route rendering and server functions, and its context remains available through the request-local async store.

Custom request middleware replaces Start's default chain. Applications exposing server functions should include CSRF protection unless they provide an equivalent policy.

Each request receives a fresh router and Fig data store. Redirects remain Router Core values whether thrown from route loading, middleware, or a server function. Fig adds no redirect protocol.

## Server Functions

The package also exposes `createServerFn`. TanStack's compiler produces the normal client, SSR, and server forms and removes server-only dependencies from browser output.

Server functions do not replace data resources. A mutation performs its remote effect, then invalidates or refreshes the affected Fig keys. Because ambient data APIs disappear after `await`, an async handler captures `readDataStore()` before yielding and uses that explicit handle afterward.
