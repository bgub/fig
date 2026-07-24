# Architecture

Status: stable

Fig is split into packages by responsibility. The basic rule is simple: every public export has one home, and internal renderer details stay internal.

## Package Ownership

Behavior lives in the package whose domain defines it. Renderer packages do not mirror core APIs. A package re-exports a type only when that type appears in one of its own public signatures; this gives consumers the right semver boundary.

For example, `useState` belongs to core because every renderer uses it. `createRoot` belongs to Fig DOM because it creates a browser root. The DOM package may mention a core type in one of its signatures, but it does not re-export `useState` for convenience.

The one mechanical exception is JSX. `@bgub/fig-dom/jsx-runtime` re-exports the core transform functions while adding the DOM-specific `JSX` namespace TypeScript needs.

- `@bgub/fig` owns the component model: elements, JSX transforms, components, hooks, read verbs, transitions, mixin descriptors, client references, asset creators, and data resources.
- `@bgub/fig-dom` owns the browser: roots, hydration, portals, `flushSync`, native events, binds, DOM asset insertion, Payload loading, Fast Refresh wiring, and DOM test utilities.
- `@bgub/fig-reconciler` owns renderer authoring: `createRenderer`, `HostConfig`, event priority, the scheduler, DevTools, refresh, and test subpaths.
- `@bgub/fig-server` owns HTML server rendering and the server half of Payload. Its `./html` subpath exports the escaping helpers frameworks need when writing companion markup.
- `@bgub/fig/payload` owns browser-safe Payload decoding. Browser code never imports `@bgub/fig-server` to decode.
- `@bgub/fig-refresh` and `@bgub/fig-vite` own the published Fast Refresh runtime and Vite integration.
- `@bgub/fig-tanstack-router` owns Fig's Router Core adapter. TanStack still owns matching, history, loading, and navigation.
- `@bgub/fig-tanstack-start` owns the Start integration: one Fig data store per request/root, document-data transport, Payload routes, and Fig rendering around Start's request and hydration cores.
- `@bgub/fig-devtools` is the private DevTools preview. Its TanStack plugin mounts an isolated Fig root, while snapshots continue to flow through Fig's global DevTools hook.

The HTML server renderer is a separate implementation that depends on `@bgub/fig`, not on the reconciler. This is why `HostConfig` has no server-rendering mode.

## Reconciler Shape

`createRenderer` is the reconciler's main stateful module. Rendering, hydration, Suspense, commit, and effects stay together because they share one host configuration and the same fiber rules.

Smaller internal modules should hide a complete rule or state machine: hook queues, lanes, scheduling, traversal, host-content interpretation, lazy data-store installation, refresh, or DevTools snapshots. We do not split the kernel into callback layers merely to shorten one file.

Fiber flags remain the source of truth for commit work. Completion summarizes descendant flags so commit can skip clean branches. Fiber-local work may also enter a sparse commit index for speed.

When a boundary discards work, it rolls that index back. Development builds compare the index with the normal tree traversal.

### Commit Coordination

`createRenderer()` owns at most one renderer-local commit coordinator. `installCommitCoordinator()` may be called after roots exist, is idempotent for the installed coordinator object, and rejects a different coordinator because two owners cannot independently park, defer, or reorder one commit transaction. A coordinator declares the optional capabilities it owns so renderer-neutral diagnostics do not mistake unrelated coordination for feature support. Its type carries the renderer's container and instance identities, so an adapter for one host cannot be installed on another. The `@bgub/fig-reconciler/commit-coordinator` entry owns this narrow contract.

A coordinator receives opaque root and finished-work identities plus a semantic work priority. Its transaction's `runMutation()` preserves the reconciler's commit and deferred-error invariants. Returning `false` promises that no mutation occurred, so the reconciler can follow its ordinary commit path.

View Transition planning is the first coordinator. `@bgub/fig-reconciler/view-transitions` contains the fiber-aware planner and constructs a coordinator from a renderer host adapter. As a version-locked module in the same package, that built-in planner has a privileged private structural view of the otherwise opaque fiber and root identities. The real reconciler types extend that private view, so a field rename or incompatible repurpose fails typechecking instead of leaving an unchecked mirror. This private contract is type-only and is not a renderer-author API. The ordinary reconciler retains only boundary recognition, static subtree marking, and the commit seam. `enableViewTransitions()` from `@bgub/fig-dom/view-transitions` explicitly installs the planner and browser adapter on Fig DOM's existing renderer; applications that omit this optional entry bundle neither implementation.

## `@bgub/fig/internal`

This entry is the versioned protocol shared by sibling Fig packages. Applications must not import it.

It contains:

- injection slots for the active render dispatcher and transition handler;
- the lazy data-store factory symbol;
- element brands and predicates, portal construction, child normalization, and thenable tracking;
- DOM-nesting tables shared by client and server rendering; and
- Suspense and Activity markers, the adjacent-text separator, and `data-fig-hydration-skip`.

Child normalization is shared because server HTML and client hydration must agree on the exact child shape. It flattens arrays and merges adjacent text while keeping promises as opaque slots. The thenable registry is process-wide for the same reason: promise-identity reads must agree across renderers.

## Lazy Data Stores

Renderers never import the data-store implementation, and importing a Fig entry never installs it as a side effect.

Each value created by `dataResource` carries its store factory on an internal symbol. A root begins with a small stub that can buffer hydration entries. The first operation that receives a resource—`readData`, `preloadData`, `invalidateData`, or `refreshData`—loads the real store and replays that buffered data.

This keeps data-free bundles data-free. It also explains one edge case: exact-key, prefix, and error-attributed invalidation cannot install the store because they do not receive a resource carrying the factory. Before installation they are inert; afterward they work normally.

## Boundaries That Stay Private

- Fibers and lanes are never exposed structurally. Commit coordinators receive opaque identity tokens and semantic priorities; renderer packages receive `EventPriority` as `"default"`, `"continuous"`, or `"discrete"`.
- The scheduler is internal to the reconciler. `act` is the public testing boundary; no `unstable_` scheduler API is published.
- The scheduler prefers `setImmediate`, creates `MessageChannel` lazily in browsers, and falls back to `setTimeout`. Importing a renderer must not keep a Node process alive.
- Development behavior uses compile-time `__FIG_DEV__` checks. Fig does not read `process.env.NODE_ENV` at runtime and does not publish separate development builds.

Each gated module declares `__FIG_DEV__` and defines its own local `__DEV__`. JSR publishes source, so those declarations cannot rely on ambient files. Bundlers also remove a gate more reliably when its constant is local.

The demo build runs `scripts/assert-dev-bundle.mjs` after packing because source-linked unit tests cannot verify the stripped bundle.
