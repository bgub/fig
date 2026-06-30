# Fig Start Server Plan

## Summary

Fig Start should keep its public server API small and runtime-neutral while
using Effect internally for the Node dev and production server implementations.
User applications should not import, provide, or understand Effect. Fig core,
fig-dom, fig-server, and other renderer packages should remain Effect-free.

The useful split is:

- `createRequestHandler(...)`: web-standard request handling, no Node server
  ownership, no Effect surface.
- dev server internals: Effect-owned lifecycle, logging, watcher, Vite, HMR,
  manifest invalidation, and graceful shutdown.
- production server internals: Effect-owned lifecycle, static asset policy,
  manifest caching, request logging, shutdown, and operational errors.

This keeps the framework API boring while giving the server implementation
typed errors, scoped resources, structured logging, and traceable workflows.

## Goals

- Keep Effect out of public Fig and Fig Start application APIs.
- Keep `createRequestHandler` portable across Node, edge-style adapters, and
  tests.
- Make dev server state explicit: Vite server, build output, client asset
  manifest, HMR connections, route module cache, file watchers, and logs.
- Make production server state explicit: immutable assets, cached manifests,
  request handler, and shutdown hooks.
- Use typed operational errors for config, TLS/portless setup, asset lookup,
  manifest loading, route loading, and server startup failures.
- Use scoped resource ownership for servers, watchers, subprocesses, and
  long-lived streams.
- Preserve the existing simple generated server entry shape for applications.

## Non-Goals

- Do not require applications to install or call Effect APIs.
- Do not move Fig renderers, RSC protocol code, or hydration code to Effect.
- Do not make dev-only dependencies reachable from the production server path.
- Do not collapse dev and production into one large conditional server.
- Do not replace the web-standard `Request -> Response` handler with a
  Node-only API.

## Public Boundary

The public surface should stay plain TypeScript:

```ts
export function createRequestHandler(options: StartHandlerOptions): StartHandler;
export function startServer(options: StartServerOptions): Server;
```

Future server helpers can stay similarly plain:

```ts
export function startDevServer(options: StartDevServerOptions): Promise<void>;
export function startProdServer(options: StartProdServerOptions): Server;
```

Those functions may run an internal Effect program, but they should return
normal JavaScript values and throw or reject with ordinary errors at the edge.
Effect should be an implementation detail of `@bgub/fig-start`'s Node server
modules, not part of the application contract.

## Internal Boundary

The internal server runtime should be organized around services rather than
globally imported mutable state:

- `StartConfig`: normalized config, mode, root, output dirs, port, public URL,
  and cache policy.
- `StartLogger`: structured logs for request, build, HMR, asset, and server
  lifecycle events.
- `BuildManifestStore`: reads and invalidates the client asset manifest and
  server-route asset metadata.
- `RouteModuleStore`: loads route modules and invalidates them in dev.
- `StaticAssetStore`: resolves and serves built assets with mode-specific cache
  headers.
- `ViteDevRuntime`: dev-only Vite server, module graph integration, HMR, and
  transforms.
- `NodeHttpServer`: owns listen, close, signal handling, and request handoff.

Reusable operations should be named and traceable, for example
`loadClientAssetManifest`, `resolveStaticAsset`, `handleStartRequest`,
`invalidateRouteModule`, and `broadcastHmrUpdate`.

## Dev Server Shape

The dev server should be built first because it has the hardest feedback loop.
It should own:

- Vite server lifecycle instead of shelling out to `vp pack --watch`.
- Server route reloads for `.server.tsx` and ordinary route file changes.
- Client manifest regeneration or in-memory derivation from Vite metadata.
- Asset resolver invalidation when chunks, CSS modules, or static assets change.
- HMR messages for client route/page updates.
- Clear per-app logs without clearing useful history.
- Portless URL display without leaking raw backing ports.

The first milestone should still reuse `createRequestHandler`. The dev server
can provide a dev-mode asset resolver and route/module loader, but the request
handler remains the semantic center of routing, SSR, RSC, redirects, status
codes, and bootstrap injection.

## Production Server Shape

The production server should be smaller and stricter:

- no watchers
- no Vite dependency
- cached client asset manifest
- cached static asset discovery
- immutable cache headers for hashed assets
- no-store only for non-hashed or explicitly dynamic responses
- graceful shutdown and request drain
- request/error logs with enough context for deployment debugging

Production should use the same request handler and the same normalized config
types, but its services should be separate from dev services so dev dependencies
cannot leak into production bundles.

## Package Layout

Keep the portable request handler where it is:

```txt
packages/fig-start/src/server.ts
packages/fig-start/src/server-assets.ts
```

Add internal Node server modules behind the existing package export:

```txt
packages/fig-start/src/server-runtime/
  config.ts
  errors.ts
  logging.ts
  manifests.ts
  static-assets.ts
  node-http.ts

packages/fig-start/src/dev-server/
  index.ts
  vite-runtime.ts
  hmr.ts
  route-modules.ts

packages/fig-start/src/prod-server/
  index.ts
```

Only `src/server.ts` and explicit future CLI entrypoints should import those
modules. Fig core packages should not import them.

## Effect Dependency Policy

When implementation starts, add Effect dependencies only to
`packages/fig-start`:

- `effect@beta`
- `@effect/platform-node` only when the Node platform helpers are actually used
- `@effect/opentelemetry` only when tracing export is wired, not before

Do not add Effect to demos, Fig core packages, or app templates. Demos should
exercise the server through normal Fig Start APIs.

## First Implementation Milestone

Start with a narrow dev server milestone:

1. Introduce internal server runtime errors and config normalization.
2. Wrap the existing Node listen/close lifecycle in an Effect scope.
3. Replace the demo `node --watch dist/server.js` loop with a Fig Start dev
   server entry that still delegates request handling to `createRequestHandler`.
4. Preserve current Turbo TUI logging behavior while moving process/server
   lifecycle into typed services.
5. Add tests for config normalization, manifest invalidation, asset cache
   policy, and graceful shutdown.

After that works, wire Vite directly into the dev runtime and remove the
remaining `vp pack --watch` dependency for Fig Start demos.
