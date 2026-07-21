# TanStack Router compatibility

`@bgub/fig-tanstack-router` targets the APIs used by generated TanStack Start
applications. It is not intended to reproduce every convenience or deprecated
alias from another framework adapter.

The conformance target is `@tanstack/router-core@1.171.15`. The owning
[concept document](https://github.com/bgub/fig/blob/main/docs/concepts/tanstack-router.md)
defines the detailed contracts and rationale; this page is the quick
compatibility reference.

## Support levels

- **Guaranteed** — part of the adapter's supported Start-first interface and
  covered by its conformance tests.
- **Compatibility** — supported, but not the recommended authoring path for a
  new TanStack Start application.
- **Deferred** — useful framework-adapter convenience that may be added later.
- **Omitted** — intentionally replaced by a Fig primitive or excluded from the
  adapter's contract.

## Compatibility matrix

| Area                         | Level         | Support                                                                                                                                                  |
| ---------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Generated routes             | Guaranteed    | `createFileRoute`, `createLazyFileRoute`, generated-tree mutation and type registration, `lazyRouteComponent`, and `lazyFn`                              |
| Code-created routes          | Compatibility | `createRootRoute`, `createRootRouteWithContext`, `createRoute`, and `addChildren`; generated file routes remain recommended                              |
| Router setup                 | Guaranteed    | `createRouter`, `RouterProvider`, route context, router option updates, browser/memory/hash history, and hydration-aware initial loading                 |
| Route APIs                   | Guaranteed    | Route-bound hooks, `Link`, `notFound`, and `getRouteApi`                                                                                                 |
| State and match hooks        | Guaranteed    | Router state, location, matches, match testing, match values, params, search, loader data/deps, route context, and navigation                            |
| Hook options                 | Guaranteed    | Selectors, structural sharing, router-wide default structural sharing, `strict: false`, and optional match/params/search reads with `shouldThrow: false` |
| Navigation                   | Guaranteed    | Imperative and declarative navigation, redirects, route masks, navigation blocking, back-history state, and Router Core lifecycle events                 |
| Links                        | Guaranteed    | Native anchors, active/inactive props, render-function children, per-link transition state, disabled links, and native click semantics                   |
| Link preloading              | Guaranteed    | Intent, render, and viewport preloading                                                                                                                  |
| Proximity preloading         | Deferred      | `preloadIntentProximity` is rejected by `LinkProps` rather than silently ignored                                                                         |
| Pending and errors           | Guaranteed    | Pending timing, minimum pending duration, Suspense boundaries, remount dependencies, route errors, reset, and not-found handling                         |
| Start SSR                    | Guaranteed    | Route-level `ssr` policies, hydration, head output, scripts, nonce propagation, and the Start data snapshot                                              |
| Asset resources              | Guaranteed    | Matched-route stylesheets, preloads, module preloads, preconnects, font preloads, and external async scripts                                             |
| Data resources               | Guaranteed    | `ensureRouteData` and Start context integration for Fig-owned caching, hydration, invalidation, and streaming                                            |
| Scroll restoration           | Guaranteed    | Router-level document scroll restoration and its Start SSR bootstrap                                                                                     |
| Element scroll restoration   | Deferred      | `useElementScrollRestoration` is not exported                                                                                                            |
| Parent/child match selectors | Deferred      | `useParentMatches` and `useChildMatches` are not exported; use `useMatches({ select })` when practical                                                   |
| Custom link construction     | Deferred      | `useLinkProps` and `createLink` are not exported; use the native `Link` interface                                                                        |
| View transitions             | Guaranteed    | Fig `<ViewTransition>` boundaries own structural animation; Router Core's document-level wrapper is disabled to prevent nesting                          |
| Activity keep-alive          | Omitted       | Navigation transitions preserve the visible tree while loading, but resolved navigation replaces it instead of retaining inactive routes                 |
| Deprecated APIs              | Omitted       | Deprecated blocker overloads, compatibility classes, and aliases are not part of the adapter interface                                                   |

## Fig-owned equivalents

Some framework-adapter components would duplicate existing Fig behavior, so
they are deliberately not exported:

| TanStack adapter convenience   | Fig contract                                                                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------------- |
| `Await`                        | `readPromise` inside `Suspense`                                                                    |
| `CatchBoundary`                | Fig `ErrorBoundary` plus route error/reset integration                                             |
| `ClientOnly`                   | The adapter's internal hydration gate for route SSR policies                                       |
| `ScrollRestoration`            | Automatic router-level setup through `createRouter` or `RouterProvider`                            |
| Activity-based inactive routes | No equivalent yet; this requires an explicit keep-alive state, effect, and data-ownership contract |

## Version upgrades

Upgrading the Router Core pin is a conformance change. Generated-route,
navigation, SSR, data, asset, and document tests must pass against the new
version before the supported target moves.
