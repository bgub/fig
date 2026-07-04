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
  load-bearing (see the registration slot below).
- `@bgub/fig-start`, `@bgub/fig-vite`, `@bgub/fig-refresh`,
  `@bgub/fig-devtools` — framework, bundler, HMR, and DevTools layers on top.

fig-server is a fully separate render implementation (it depends only on
`@bgub/fig` and `@bgub/fig-data`, never on the reconciler) — that split is why
`HostConfig` never grew a server mode.

## The Internal Entry (`@bgub/fig/internal`)

The cross-package protocol registry, versioned together with the sibling
packages and never for apps:

- injection slots: the render dispatcher, the data-store factory, the
  transition handler;
- the element model: `$$typeof` brand predicates (`isValidElement`,
  `isSuspense`, ...), `collectChildren`/`NormalizedChild`, thenable registry
  (`readThenable`/`trackThenable`);
- shared HTML knowledge both renderers need: DOM-nesting validation tables and
  the Suspense/Activity streaming marker constants.

Child normalization (`collectChildren`) is shared because the server emits
merged text nodes into HTML and hydration matches them against client fiber
children — the two sides must not drift. Same for the thenable registry:
promise identity keyed suspend/resume must agree between client and server.

## The Registration Slot

Renderers never bundle `@bgub/fig-data`. Importing that package registers its
store factory into a slot on `@bgub/fig/internal` (a module side effect,
reflected in its `sideEffects` flag). Roots created before it loads hold a stub
store that upgrades itself in place on registration (covering code-split apps)
and buffers `hydrate()`/`initialData` entries for replay. The invariant that
makes this safe: every runtime data API is importable only from
`@bgub/fig-data`, so no data read can precede registration. Type exports do not
weaken it — data-protocol types export from `@bgub/fig` proper.

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
