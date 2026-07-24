---
packages:
  npm:@bgub/fig-tanstack-start:
    replay:
      - exit-prerelease(npm:@bgub/fig-tanstack-start)
---

## Own the TanStack Start document transport

`StartScripts` now owns Fig data serialization, the initial Payload insertion
point, and TanStack's bootstrap scripts as one ordered document surface. The
Payload transport targets a Fig-owned marker instead of matching TanStack's
private hydration-barrier markup.

The Vite adapter records its exact Router and Start core compatibility profile
and rejects emitted Solid Router or Start adapter modules. Server-only assets
are still mirrored into the public client output, but a conflicting client
asset now fails the build instead of being silently overwritten.
