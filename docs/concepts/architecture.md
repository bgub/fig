# Architecture

Status: stable

How the packages relate, who owns what, and the cross-package protocol.

## Package Ownership

Every app-facing export has exactly one home: behavior lives in the package whose domain defines it. Renderer packages do not mirror core app APIs, and a package re-exports a _type_ only when that type appears in its own public signatures (types follow signatures — that is what gives consumers semver protection). The one mechanical exception is a renderer's JSX transform subpaths: `@bgub/fig-dom/jsx-runtime` re-exports the core transform functions while supplying the DOM-specific `JSX` namespace required by TypeScript.

- `@bgub/fig` — the component model: elements and the JSX runtime, host mixin descriptors and `createMixin`, components (`Fragment`, `Suspense`, `Activity`, `ErrorBoundary`, `ViewTransition`), hooks, the read verbs (`readContext`, `readPromise`, `readData`), `transition`, `isValidElement`, `lazy`, `clientReference`, asset-resource creators, and the data layer — `dataResource`, `createDataStore`, the freshness verbs, and the store implementation (which stays out of data-free bundles; see the lazy store installation protocol below). The `./payload` subpath is the browser-safe client decoder home: `decodePayloadStream` plus its narrow result/options and client-reference resolver types (payload.md); rows, codecs, and value encoding remain internal. Browser code never imports `@bgub/fig-server` to decode. The `./server` subpath is the server-file authoring entry (`serverDataResource`); its packaging transform is `figData` in `@bgub/fig-vite`.
- `@bgub/fig-dom` — the browser boundary: `createRoot`/`hydrateRoot`/`createPortal`, `flushSync`, the `on()` event mixin, `bind`/`composeBind`, `insertAssetResources`, `payloadDataLoader` (the payload-endpoint → data-resource adapter), host-prop JSX types, the `./refresh` HMR subpath (`scheduleRefresh` plus the `RefreshFamily`/`RefreshUpdate` signature types; scheduler configuration stays internal), and `./test-utils` (`act`).
- `@bgub/fig-reconciler` — renderer authoring: `createRenderer`/`HostConfig`, `EventPriority`/`runWithEventPriority`, the internal cooperative scheduler, and the `./devtools`, `./refresh`, and `./test-utils` (`act`) subpaths.
- `@bgub/fig-server` — server rendering (`renderToStream` grid, `prerender`) and the `./payload` server half (`renderToPayloadStream`). The serializer and decoder share their private row/value format through `@bgub/fig/internal`; framework adapters own delivery transports. The `./html` subpath owns `escapeAttribute`/`escapeText` plus `escapeScriptText`/`escapeScriptJson`, whose contract is "consistent with fig-server's own HTML emission".
- `@bgub/fig-refresh` — the published HMR runtime layer.
- `@bgub/fig-vite` — the published Vite integration for Fast Refresh and `serverDataResource` packaging.
- `@bgub/fig-tanstack-router` — the TanStack Router framework adapter: Fig route components and hooks, the private reactive-store bridge supplied to `RouterCore`, and native anchor navigation. Matching, loading, and history remain owned by `@tanstack/router-core`.
- `@bgub/fig-tanstack-start` — the TanStack Start runtime adapter: one Fig-owned request/root data store, Fig document-data serialization, Payload route serving/adoption, and Fig server/client rendering around Start's request and hydration cores.
- `@bgub/fig-devtools` — the private DevTools workspace preview. Its `./tanstack` subpath adapts the existing hook-backed panel to TanStack Devtools' DOM plugin seam; it mounts an isolated non-publishing Fig root per host container and owns explicit teardown, while commit snapshots continue to flow directly through Fig's global hook rather than a second event transport. Inspection highlights portal into the host's owner document below the outer shell's stacking context so transformed or clipped plugin panels cannot change their viewport geometry.

fig-server is a fully separate render implementation (it depends only on `@bgub/fig`, never on the reconciler) — that split is why `HostConfig` never grew a server mode.

### Reconciler internals

`createRenderer` is the stateful kernel: render, hydration, Suspense, commit, and effect phases stay together because they share one host configuration and one set of fiber invariants. Pure mechanisms sit behind small internal modules instead: fiber/hook vocabularies, traversal, hook-queue operations, host-content interpretation, lazy root-data installation, lanes/scheduling, refresh, and DevTools snapshotting. New files should hide a complete rule or state machine; do not split the kernel into callback-heavy pass-through layers merely to make the main file shorter.

Fiber flags are the source of truth for commit work. Completion folds the subtree-visible flags into a compact descendant summary: order-sensitive work is interpreted through pruned tree walks, while fiber-local work also enters a sparse commit index. That index is only an acceleration structure; captures roll it back to a typed checkpoint, and development parity checks verify it against the tree.

## The Internal Entry (`@bgub/fig/internal`)

The cross-package protocol registry, versioned together with the sibling packages and never for apps:

- injection slots: the render dispatcher and transition handler;
- the lazy data-store protocol: the internal symbol that lets data resources carry their store factory to renderers without import-time registration;
- the element model: `$$typeof` brand predicates (`isSuspense`, `isPortal`, ...; `isValidElement` is app-facing and lives only on the main entry), `createPortalNode` (renderers wrap it in their container-typed `createPortal`), `collectChildren`/`NormalizedChild`, thenable registry (`readThenable`/`trackThenable`);
- shared HTML knowledge both renderers need: DOM-nesting validation tables, the Suspense/Activity streaming marker constants, the text-separator comment data that keeps adjacent text fibers' DOM nodes apart, and the single `data-fig-hydration-skip` attribute for server-owned DOM nodes that have no client fiber.

Child normalization (`collectChildren`) is shared because the server emits merged text nodes into HTML and hydration matches them against client fiber children — the two sides must not drift. Same for the thenable registry: promise identity keyed suspend/resume must agree between client and server.

## Lazy Data-Store Installation

Renderers never import the store implementation, and no fig entry installs it as an import side effect. Instead, each resource created by `dataResource` carries the store factory on an internal symbol, so the implementation's only bundle reference is `dataResource` itself — a bundle that never defines a resource never ships the store. Roots created before any resource exists hold a stub store that buffers `hydrate()`/`initialData` entries. The first real data operation (`readData`, `preloadData`, `invalidateData`, or `refreshData`) passes a resource to the stub; the stub installs the real store from the resource's factory and replays buffered hydration entries.

The operations that can install the real store (`readData`, `preloadData`, `invalidateData`, and `refreshData`) all take a resource created by `dataResource`, which carries the factory. Exact-key, prefix, and attributed- error invalidation cannot install a store because they have no resource from which to obtain the factory; on an uninstalled stub they are inert (`invalidateDataError` returns `false`). Once any resource-backed operation installs the store, those targeting variants operate normally. Type exports do not weaken the invariant — the data-protocol types have no runtime footprint.

## Boundaries That Never Leak

- Lanes and fibers never cross a public boundary; priority crosses as `EventPriority = "default" | "continuous" | "discrete"` strings.
- The cooperative scheduler is an internal fig-reconciler module (not a published package) exposing no `unstable_` APIs; `act` is the public testing surface that temporarily routes scheduled callbacks into a test queue. Its work loop prefers `setImmediate` and creates its `MessageChannel` lazily, so importing a renderer can never keep a Node process alive.
- Dev-only behavior (strict double render, diagnostics, DevTools emission) uses inline `__FIG_DEV__` checks that Fig library builds define away; there are no separate dev builds. `__FIG_DEV__` is the only dev-gating mechanism: runtime `process.env.NODE_ENV` is never consulted (a consumer that wants dev mode must define `__FIG_DEV__: true` at build time, as the monorepo's demos and tests do via `vite.config.ts`). Each gated module carries its own `declare const __FIG_DEV__` plus a module-local `__DEV__` const on purpose: JSR publishes raw source, so ambient declaration files are unavailable, and bundlers only fold gates whose const lives in the same module. Demo builds are asserted dev-mode by `scripts/assert-dev-bundle.mjs` right after pack, because unit tests always run source-linked with the dev define and cannot see a stripped bundle.
