# Fig TanStack DB

`@bgub/fig-tanstack-db` connects TanStack DB collections and live queries to Fig's data resources, Suspense, and hydration.

- `dbClientResource(options)` creates one `DbClient` per Fig data store, with cleanup when the store is disposed.
- `dbClient` is the default client resource.
- `liveQuery(...)` defines a watched data resource backed by a TanStack live query. Read it with Fig's `readData`.
- `capabilityDependency(...)` reads a named client dependency and checks that it is available, allowing server rendering to defer browser-only work.

TanStack DB owns collections, synchronization, persistence, and optimistic transactions. Fig owns observation lifetimes, render snapshots, and hydration. By default only query result rows transfer to the browser. Opt collections into `dbClientResource({ transferCollection })` to also seed their rows and sync metadata before browser synchronization begins.

Install this package alongside `@bgub/fig`. The adapter includes its compatible TanStack DB dependency. It releases independently from the Fig Router and Start adapters.

See the [data resource contract](https://github.com/bgub/fig/blob/main/docs/concepts/data.md) and the public TypeScript declarations for API signatures and options.
