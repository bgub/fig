# TanStack Start Adapter

Status: runtime and Vite plugin implemented; native TanStack framework target pending

`@bgub/fig-tanstack-start` adapts TanStack Start's request and hydration cores to Fig. TanStack owns request middleware, route loading, redirects, and router-match dehydration. Fig owns component rendering, data-resource identity and freshness, the data store, its document serialization, and asset resources.

## Single-Store Ownership

`createStartDataContext()` creates one root-neutral Fig store and returns the router context containing it. Server route loaders call `ensureRouteData` through that handle before rendering. `renderRouterToStream` passes the same store to `renderToDocumentStream`, which adopts it and attaches the server renderer lifecycle. On the client, the adapter decodes the Fig-owned document snapshot into a fresh Fig store before `hydrateRoot` adopts it and attaches reactive scheduling. TanStack never stores the values in `loaderData` and never owns or copies the cache.

The application renders `StartData` near the end of its document body, after route content and before `Scripts`. It emits a non-executable JSON script containing Fig's encoded data entries. Encoding uses Fig's payload value codec, including graph identity and supported non-JSON values; `<` and JavaScript line-separator characters are escaped for safe inline HTML. On the client, `createStartDataContext` eagerly decodes that earlier script while constructing the router, before TanStack hydration can start client-only route loaders. The client entry repeats the step idempotently as a fallback before the first Fig render in case router construction preceded the script.

The contract is covered end to end: a Router loader populates the server store, that exact store renders the document, a fresh client document supplies the serialized snapshot, initial hydration performs no resource load, and invalidating the hydrated entry performs exactly one new load.

`apps/demo-tanstack-start` is the executable proof. Its production Vite build and preview server exercise generated and lazy file routes, streamed SSR, hydration, metadata navigation, redirects, middleware, a compiled server mutation, and a data-resource refresh.

## Vite and Compiler Boundary

`@bgub/fig-tanstack-start/plugin/vite` delegates environment planning, route manifests, server-function extraction, dev serving, production builds, and preview serving to TanStack's plugin core. It supplies physical default-entry paths so production output has stable client/server entry names. The client entry directly hydrates Fig; the compatibility plugin supplies the generated server request handler.

TanStack's compiler currently accepts only React, Solid, and Vue framework targets and derives package names from that target. The adapter privately uses the Solid target, rewrites Fig Start root imports before compilation, and maps the compiler's Solid router, Start, and RPC module ids back to Fig entries. The route generator also hard-codes that target when normalizing `createFileRoute` and `createLazyFileRoute` imports, so those constructor imports retain the compatibility ID; applications mirror the runtime aliases with TypeScript `paths` entries pointing at the Fig Router and Start packages. The Start alias lets the generated registration footer carry `src/start.ts` middleware context types into server functions. All runtime modules resolve to Fig and no Solid runtime enters either build.

The plugin also owns Start's storage-context module id. Its adapter uses the same global `AsyncLocalStorage` key and semantics on the server, preserving request isolation across bundled copies and interleaved requests, while the browser implementation is inert. Start client core stays out of dependency optimization so its virtual router and start entries resolve per application during development.

The compatibility layer does not alter runtime ownership. Fig still owns the data store, document rendering, hydration, and asset resources; TanStack still owns request handling, manifests, redirects, middleware, and server-function transport. A future native framework descriptor can replace the aliases without changing those interfaces.

TanStack's Start plugin runs its file-route generator and code splitter. The Fig router implements the generated route, lazy route, lazy component, and lazy function contracts, so file routes and split route chunks use ordinary Fig route objects. Development route edits invalidate and reload the application; state-preserving Fig refresh remains part of replacing the closed framework target with a native Fig descriptor.

## Request Context, Middleware, and Redirects

The package root exposes `createStart`, `createMiddleware`, and `createCsrfMiddleware` from Start client core. A user `src/start.ts` can install global request and function middleware. Request middleware executes before router rendering and server functions; the resulting context is stored in Start's request-local async context and is visible to function middleware and handlers. Custom request middleware replaces Start's default request chain, so applications that expose server functions include `createCsrfMiddleware({ filter: context => context.handlerType === "serverFn" })` unless they provide equivalent protection.

Each request creates a fresh router and Fig data store. The shared global storage symbol deduplicates the `AsyncLocalStorage` instance across bundled copies without sharing its current value: concurrent SSR requests retain distinct middleware contexts through async route loaders and streamed rendering. The production demo asserts this with interleaved requests carrying distinct ids.

Redirects remain Router Core values. A redirect thrown from `beforeLoad`, a loader, middleware, or a server function is resolved by Start's handler on the server and by Router Core during client navigation; the Fig renderer adds no redirect protocol.

## Server Functions

The package root exposes `createServerFn` from Start client core. The plugin compiler turns Fig-authored imports into the standard client, SSR, and server RPC forms. The compatibility plugin resolves those compiler-only module ids directly to TanStack's core transports rather than exposing them as public Fig package entries. Server-only dependencies are removed from the client build.

Server functions do not replace data resources. A mutation performs its remote effect, then invalidates or refreshes the affected Fig keys. Since ambient data mutation functions exist only during Fig's synchronous execution window, an async event captures `readDataStore()` before its first `await` and uses that explicit handle afterward.
