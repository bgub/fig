## @bgub/fig-vite@0.1.0

### Let tooling and adapters follow independent release trains

Fast Refresh and Vite now accept compatible runtime releases instead of
requiring the same exact Fig version. The TanStack Router and Start adapters do
the same while remaining pinned to matching versions within each adapter pair.

### Publish stable pre-1.0 releases

Fig's runtime, tooling, and TanStack adapter packages now publish without an
`alpha` prerelease suffix. Patch releases preserve compatibility within their
current `0.x` minor line; minor releases may make breaking changes before 1.0.

### Refresh resolves the app's renderer runtime

`figRefresh` now imports `@bgub/fig-dom/refresh` through its bare specifier
rather than a resolved `/@fs/` path, so app-level aliases, dedupe, and
prebundling apply and the refresh scheduler cannot be instantiated twice.

### TanStack Start's client graph is prebundled

The TanStack Start adapter now prebundles `@tanstack/start-client-core` in
development while leaving its application-bound router and Start imports as
external Vite modules. This reduces the module-request waterfall without
freezing generated app entries or the linked Fig adapter packages. Production
continues to use Vite's normal application bundling.

### Avoid redundant Vite transforms

Production builds now rely on Vite's scope-aware `__FIG_DEV__` replacement
instead of running an additional Babel pass. Development loads the refresh
transformer only when a matching application module needs it.

### Use one data-resource API in every environment

`dataResource` now covers shared, browser, and server-only loaders without a
second API. Server-only loaders belong behind the framework's server module
boundary; browser code uses an explicit key-only resource when it needs the
same hydrated value.

The pass-through `serverDataResource` API, `@bgub/fig/server` entry point,
`figData` Vite transform, and generated browser resource stubs are removed.

### TanStack Start gains state-preserving Fast Refresh

The TanStack Start Vite adapter now installs Fig Fast Refresh automatically.
Component edits update in place and preserve hook state in accepted modules.

`@bgub/fig-vite` is now a public package containing the reusable Fast Refresh
and server data-resource transforms.

### Let Fig's Vite integration own runtime configuration

The new `fig()` Vite integration defines Fig's development gate and installs
Fast Refresh. TanStack Start composes it automatically, so applications no
longer need to configure Fig's compile-time mode or SSR package bundling
themselves.

`@bgub/fig-vite` now uses the application's Fig DOM renderer as a peer instead
of installing a private renderer copy.

The development gate follows Vite's command rather than its mode: serving
enables development behavior, while builds—including `--mode development`—strip
it from production output.

Published npm packages now expose development artifacts through a Fig-owned
condition, allowing the Vite integration to enable diagnostics and Fast Refresh
for ordinary installs while explicit static overrides remain authoritative and
default production imports retain their previous dead-code elimination. A
static `false` override also disables Fast Refresh instrumentation.

## @bgub/fig-vite@0.1.0-alpha.6

### Avoid redundant Vite transforms

Production builds now rely on Vite's scope-aware `__FIG_DEV__` replacement
instead of running an additional Babel pass. Development loads the refresh
transformer only when a matching application module needs it.

## @bgub/fig-vite@0.1.0-alpha.3

### Let Fig's Vite integration own runtime configuration

The new `fig()` Vite integration defines Fig's development gate and installs
Fast Refresh. TanStack Start composes it automatically, so applications no
longer need to configure Fig's compile-time mode or SSR package bundling
themselves.

`@bgub/fig-vite` now uses the application's Fig DOM renderer as a peer instead
of installing a private renderer copy.

The development gate follows Vite's command rather than its mode: serving
enables development behavior, while builds—including `--mode development`—strip
it from production output.

Published npm packages now expose development artifacts through a Fig-owned
condition, allowing the Vite integration to enable diagnostics and Fast Refresh
for ordinary installs while explicit static overrides remain authoritative and
default production imports retain their previous dead-code elimination. A
static `false` override also disables Fast Refresh instrumentation.

## @bgub/fig-vite@0.1.0-alpha.1

### Refresh resolves the app's renderer runtime

`figRefresh` now imports `@bgub/fig-dom/refresh` through its bare specifier
rather than a resolved `/@fs/` path, so app-level aliases, dedupe, and
prebundling apply and the refresh scheduler cannot be instantiated twice.

### TanStack Start's client graph is prebundled

The TanStack Start adapter now prebundles `@tanstack/start-client-core` in
development while leaving its application-bound router and Start imports as
external Vite modules. This reduces the module-request waterfall without
freezing generated app entries or the linked Fig adapter packages. Production
continues to use Vite's normal application bundling.

### Use one data-resource API in every environment

`dataResource` now covers shared, browser, and server-only loaders without a
second API. Server-only loaders belong behind the framework's server module
boundary; browser code uses an explicit key-only resource when it needs the
same hydrated value.

The pass-through `serverDataResource` API, `@bgub/fig/server` entry point,
`figData` Vite transform, and generated browser resource stubs are removed.

### TanStack Start gains state-preserving Fast Refresh

The TanStack Start Vite adapter now installs Fig Fast Refresh automatically.
Component edits update in place and preserve hook state in accepted modules.

`@bgub/fig-vite` is now a public package containing the reusable Fast Refresh
and server data-resource transforms.

## @bgub/fig-vite@0.1.0-alpha.0 (alpha)

### Initial alpha release

Fig Fast Refresh and server data-resource transforms for Vite.

# Changelog
