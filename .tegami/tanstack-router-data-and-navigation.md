---
packages:
  npm:@bgub/fig-tanstack-router:
    replay:
      - exit-prerelease(npm:@bgub/fig-tanstack-router)
  npm:@bgub/fig-tanstack-start:
    replay:
      - exit-prerelease(npm:@bgub/fig-tanstack-start)
---

## Complete Fig-native data and navigation patterns

TanStack Start routes can now preload Payload data and return immediately,
letting Fig Suspense stream the result and its asset resources without copying
values into Router loader data. Initial Payload responses registered after the
document shell starts are embedded before hydration, preventing a duplicate
client request.

The Router adapter adds modern object-only `useBlocker` and reactive
`useCanGoBack` hooks, makes the concrete Router and RouteApi constructors
internal, and rejects unsupported proximity preloading in `LinkProps`.
Fig's structural `ViewTransition` remains the sole document-transition owner,
even when a TanStack navigation carries its `viewTransition` option.
