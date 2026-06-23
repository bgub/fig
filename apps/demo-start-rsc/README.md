# @bgub/fig-demo-start-rsc

A fig-start app on a Vite SSR pipeline that demonstrates `.server.tsx` server
components (RSC) — the M2 first slice.

## Run it

```sh
pnpm build                                  # so the Vite config can import @bgub/fig-start/vite
pnpm --filter @bgub/fig-demo-start-rsc dev  # http://localhost:4310
```

The server is `server.mjs`: it embeds Vite in middleware mode, loads the
fig-start handler via `ssrLoadModule`, and serves the client through Vite. Other
Fig packages resolve to source via `vite.config.ts` aliases.

## What to look at

- Isomorphic routes (`/`, `/about`) are server-rendered and hydrated (M1).
- `/dashboard` is a **server route** (`routes/dashboard.server.tsx`): it renders
  through Fig's RSC stream. Its `import { Island } from "./Island.tsx"` is
  rewritten by the `@bgub/fig-start/vite` plugin into a client reference.

### Verify (browser)

1. Load `/dashboard`. View source: the layout is SSR'd, the dashboard subtree is
   an empty `<div data-fig-rsc-slot="/dashboard">`, and an `__fig_start_rsc__`
   script holds the RSC rows including a `client` row whose id ends
   `Island.tsx#Island`.
2. On load, the dashboard markup + island appear (client-rendered from the
   payload; the island resolves through `virtual:fig-start/client-manifest`).
3. Click the island → the count increments (the client reference hydrated).

## Deferred (later milestones)

SSR-of-RSC (the RSC subtree is client-rendered, not in the initial HTML);
client-side navigation to a server route (`/__rsc` endpoint); excluding
`.server.tsx` from the client bundle; nested server components; route
auto-discovery.
