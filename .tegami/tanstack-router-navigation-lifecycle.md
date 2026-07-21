---
packages:
  npm:@bgub/fig-tanstack-router: patch
---

## Settle Router navigation through Fig transitions

`RouterProvider` now merges partial options and route context before the first
loader runs. Browser navigation uses Fig transitions, publishes Router's load,
mount, resolved, and rendered lifecycle events in order, ignores superseded
navigation completions, and keeps `isTransitioning` accurate while an
asynchronous navigation settles.

Hydration skips duplicate initial loads, canonical validated locations replace
the browser URL, and provider unmounts release history and transition bindings.
