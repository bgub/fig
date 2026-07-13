---
packages:
  npm:@bgub/fig-start: patch
---

## Dev server re-optimizes when linked package dists change between runs

Vite's dep-optimizer cache keys on the lockfile and config, not the contents
of workspace-linked dists — so a cold start after `pnpm build` rewrote those
dists served stale prebundled chunks, showing up as hydration mismatches and
dead DevTools inspection. The Fig Start dev server now fingerprints the
linked packages' dist directories (file name, size, mtime) at startup,
stores the fingerprint beside the optimizer cache, and forces one
re-optimization when it differs from the previous run. The existing watcher
still handles rebuilds while the server is running.
