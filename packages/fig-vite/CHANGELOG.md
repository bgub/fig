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
