# Architecture

Status: stable

How the packages relate, who owns what, and the cross-package protocol.

## Package Ownership

Every export has exactly one home: behavior lives in the package whose domain
defines it. Renderer packages never mirror core symbols; a package re-exports a
_type_ only when that type appears in its own public signatures (types follow
signatures — that is what gives consumers semver protection).

- `@bgub/fig` — the component model: elements and the JSX runtime, components
  (`Fragment`, `Suspense`, `Activity`, `ErrorBoundary`, `Assets`), hooks, the
  read verbs (`readContext`, `readPromise`), `transition`, `lazy`,
  `clientReference`, asset-resource creators, and all data-protocol _types_.
- `@bgub/fig-dom` — the browser boundary: `createRoot`/`hydrateRoot`/
  `createPortal`, `flushSync`, `on()`/`events`, `bind`/`composeBind`,
  `insertAssetResources`, host-prop JSX types, and the `./refresh` HMR subpath.
- `@bgub/fig-reconciler` — renderer authoring: `createRenderer`/`HostConfig`,
  `EventPriority`/`runWithEventPriority`, the internal cooperative scheduler,
  and the `./devtools` + `./refresh` subpaths.
- `@bgub/fig-server` — server rendering (`renderToStream` grid, `prerender`)
  and the `./payload` server-component layer. `escapeAttribute`/`escapeText`
  are exported because their contract is "consistent with fig-server's own
  HTML emission".
- `@bgub/fig-data` — every _runtime_ data API. This exclusivity is
  load-bearing (see the lazy store installation protocol below).
- `@bgub/fig-start`, `@bgub/fig-vite`, `@bgub/fig-refresh`,
  `@bgub/fig-devtools` — framework, bundler, HMR, and DevTools layers on top.

fig-server is a fully separate render implementation (it depends only on
`@bgub/fig` and `@bgub/fig-data`, never on the reconciler) — that split is why
`HostConfig` never grew a server mode.

## The Internal Entry (`@bgub/fig/internal`)

The cross-package protocol registry, versioned together with the sibling
packages and never for apps:

- injection slots: the render dispatcher and transition handler;
- the lazy data-store protocol: the internal symbol that lets
  `@bgub/fig-data` resources carry their store factory to renderers without
  import-time registration;
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

Renderers never bundle `@bgub/fig-data`, and importing `@bgub/fig-data` has no
registration side effect. Instead, each data resource created by that package
carries the store factory on an internal symbol from `@bgub/fig/internal`.
Roots created before fig-data loads hold a stub store that buffers
`hydrate()`/`initialData` entries. The first real data operation
(`readData`, `preloadData`, `invalidateData`, or `refreshData`) passes a
resource to the stub; the stub installs the real store from the resource's
factory and replays buffered hydration entries.

The invariant that makes this safe: every runtime data API is importable only
from `@bgub/fig-data`, so a real data operation necessarily has a resource
created by that package. Type exports do not weaken it — data-protocol types
export from `@bgub/fig` proper.

## Boundaries That Never Leak

- Lanes and fibers never cross a public boundary; priority crosses as
  `EventPriority = "default" | "continuous" | "discrete"` strings.
- The cooperative scheduler is an internal fig-reconciler module (not a
  published package) exposing no `unstable_` APIs. Its work loop prefers
  `setImmediate` and creates its `MessageChannel` lazily, so importing a
  renderer can never keep a Node process alive.
- Dev-only behavior (strict double render, diagnostics, DevTools emission)
  uses inline `process.env.NODE_ENV !== "production"` checks that app bundlers
  strip; there are no separate dev builds.
