# Architecture

Status: stable

How the packages relate, who owns what, and the cross-package protocol.

## Package Ownership

Every export has exactly one home: behavior lives in the package whose domain
defines it. Renderer packages never mirror core symbols; a package re-exports a
_type_ only when that type appears in its own public signatures (types follow
signatures — that is what gives consumers semver protection).

- `@bgub/fig` — the component model: elements and the JSX runtime, components
  (`Fragment`, `Suspense`, `Activity`, `ErrorBoundary`), hooks, the
  read verbs (`readContext`, `readPromise`, `readData`), `transition`,
  `isValidElement`, `lazy`, `clientReference`, asset-resource creators, and
  the data layer — `dataResource`, the freshness verbs, and the store
  implementation (which stays out of data-free bundles; see the lazy store
  installation protocol below). The `./server` subpath is the server-file authoring entry
  (`serverDataResource`); its packaging transform ships as `figData` in
  `@bgub/fig-vite` (version-synced — build-time skew is benign, runtime
  symbol skew is not).
- `@bgub/fig-dom` — the browser boundary: `createRoot`/`hydrateRoot`/
  `createPortal`, `flushSync`, `on()`/`events`, `bind`/`composeBind`,
  `insertAssetResources`, host-prop JSX types, the `./refresh` HMR subpath,
  and `./test-utils` (`act`).
- `@bgub/fig-reconciler` — renderer authoring: `createRenderer`/`HostConfig`,
  `EventPriority`/`runWithEventPriority`, the scheduler-backed `act` testing
  primitive used by renderer test utilities, the internal cooperative
  scheduler, and the `./devtools` + `./refresh` subpaths.
- `@bgub/fig-server` — server rendering (`renderToStream` grid, `prerender`)
  and the `./payload` server-component layer. `escapeAttribute`/`escapeText`
  are exported because their contract is "consistent with fig-server's own
  HTML emission".
- `@bgub/fig-start`, `@bgub/fig-vite`, `@bgub/fig-refresh`,
  `@bgub/fig-devtools` — framework, bundler, HMR, and DevTools layers on top.

fig-server is a fully separate render implementation (it depends only on
`@bgub/fig`, never on the reconciler) — that split is why `HostConfig` never
grew a server mode.

## The Internal Entry (`@bgub/fig/internal`)

The cross-package protocol registry, versioned together with the sibling
packages and never for apps:

- injection slots: the render dispatcher and transition handler;
- the lazy data-store protocol: the internal symbol that lets data resources
  carry their store factory to renderers without import-time registration;
- the element model: `$$typeof` brand predicates (`isValidElement`,
  `isSuspense`, ...), `collectChildren`/`NormalizedChild`, thenable registry
  (`readThenable`/`trackThenable`);
- shared HTML knowledge both renderers need: DOM-nesting validation tables and
  the Suspense/Activity streaming marker constants.

Child normalization (`collectChildren`) is shared because the server emits
merged text nodes into HTML and hydration matches them against client fiber
children — the two sides must not drift. Same for the thenable registry:
promise identity keyed suspend/resume must agree between client and server.

## Lazy Data-Store Installation

Renderers never import the store implementation, and no fig entry installs it
as an import side effect. Instead, each resource created by `dataResource`
carries the store factory on an internal symbol, so the implementation's only
bundle reference is `dataResource` itself — a bundle that never defines a
resource never ships the store. Roots created before any resource exists hold
a stub store that buffers `hydrate()`/`initialData` entries. The first real
data operation (`readData`, `preloadData`, `invalidateData`, or
`refreshData`) passes a resource to the stub; the stub installs the real
store from the resource's factory and replays buffered hydration entries.

The invariant that makes this safe: every runtime data operation takes a
resource, and every resource comes from `dataResource`, which carries the
factory. Type exports do not weaken it — the data-protocol types have no
runtime footprint.

## Boundaries That Never Leak

- Lanes and fibers never cross a public boundary; priority crosses as
  `EventPriority = "default" | "continuous" | "discrete"` strings.
- The cooperative scheduler is an internal fig-reconciler module (not a
  published package) exposing no `unstable_` APIs; `act` is the public testing
  surface that temporarily routes scheduled callbacks into a test queue. Its
  work loop prefers `setImmediate` and creates its `MessageChannel` lazily, so
  importing a renderer can never keep a Node process alive.
- Dev-only behavior (strict double render, diagnostics, DevTools emission)
  uses inline `process.env.NODE_ENV !== "production"` checks that app bundlers
  strip; there are no separate dev builds.
