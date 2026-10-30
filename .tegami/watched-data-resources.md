---
packages:
  "@bgub/fig":
    type: minor
  "@bgub/fig-reconciler":
    type: minor
---

Add watched data resources. A resource's optional `watch(...args, context)` pushes values into its entry while a committed reader exists, through `publish`, `fail`, `refresh` (which now resolves with its `DataRefreshResult`), and `invalidate`. A resource with `watch` and no `load` is push-only: its first read suspends until the first publish, and the render or Suspense fallback waiting on it holds the watch open with no time limit. Watches never run on the server and start only after the hydration commit, so hydration always renders the hydrated value.

Load and watch contexts now include `data`, the store running them. `data.ensureData` keeps the ensured entry cached (and a push-only dependency's watch running) while the dependent load's value or watch is live, and a retired dependent's pending wait rejects with its signal's reason. Code that calls a resource's `load` directly, such as an HTTP endpoint or a test, must now pass `data`, for example a `createDataStore()` it disposes afterwards.

Add the `equals` resource option, defaulting to `Object.is`: a load, refresh, or publish equal to the visible value keeps that value, its identity, and its generation, re-renders nothing, and still clears staleness and refresh errors. Previously an identical value re-rendered every reader. Add the per-resource `inactiveRetentionMs` option, overriding the store's inactive retention for that resource's entries.

In the reconciler, a capturing Suspense boundary now takes over the data reads its suspended content was waiting on and subscribes to them with its fallback, and render attempts release discarded read sets to the store. Unmounting a waiting fallback therefore also stops an abandoned value-less load. Client root hosts set `watchSources`; server stores never start watches.

Dependency reads from retired loads or watches reject before creating cache entries.
