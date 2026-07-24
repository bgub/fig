---
packages:
  npm:@bgub/fig-tanstack-start:
    replay:
      - exit-prerelease(npm:@bgub/fig-tanstack-start)
  npm:@bgub/fig-vite:
    replay:
      - exit-prerelease(npm:@bgub/fig-vite)
---

## TanStack Start gains state-preserving Fast Refresh

The TanStack Start Vite adapter now installs Fig Fast Refresh automatically.
Component edits update in place and preserve hook state in accepted modules.

`@bgub/fig-vite` is now a public package containing the reusable Fast Refresh
and server data-resource transforms.
