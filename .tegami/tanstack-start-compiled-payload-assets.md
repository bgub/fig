---
packages:
  npm:@bgub/fig-server:
    replay:
      - exit-prerelease(npm:@bgub/fig-server)
  npm:@bgub/fig-tanstack-start:
    replay:
      - exit-prerelease(npm:@bgub/fig-tanstack-start)
---

## Compile Payload components and their assets

Fig TanStack Start now turns stylesheet imports in the ordinary component graph
reached from a `payloadResource` render callback into Payload asset dependencies
automatically. The same declaration compiles to a private TanStack server
function and Payload response, so applications no longer author
`createServerFn`, `renderPayloadResponse`, or request plumbing for Payload
routes. Payload rendering is independent of filenames. Applications
conventionally use `.payload.tsx` for the shared resource declaration, but the
suffix is only a human label. Components and assets referenced only by the
render callback are omitted from the browser bundle. Compiled styles use the
existing Payload row ownership, dedupe, streaming, and reveal-gating behavior
without requiring an `assets(stylesheet(...))` wrapper.

Applications mark the exceptional SSR-plus-hydration boundary with
`<Isomorphic component={Counter} ... />` and an ordinary static import. The
generated per-bundle manifest owns module resolution, stable component
identity, and client CSS metadata, so applications no longer author
`clientReference`, `createPayloadClientReferenceResolver`, ids, or dynamic
imports. Ordinary component uses remain Payload-rendered.
