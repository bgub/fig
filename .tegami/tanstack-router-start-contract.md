---
packages:
  npm:@bgub/fig-tanstack-router:
    replay:
      - exit-prerelease(npm:@bgub/fig-tanstack-router)
---

## Define the Start-first Router support contract

The Router adapter now documents generated TanStack Start file routes as its
primary interface, distinguishes supported code-created routes from deferred
or deliberately omitted adapter conveniences, and clarifies when route data
belongs in Fig data resources versus Router `loaderData`. The package also
declares itself side-effect-free and guards the production Start-oriented
surface with a bundle-size limit.
