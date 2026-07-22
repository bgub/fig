---
packages:
  npm:@bgub/fig-server: minor
  npm:@bgub/fig-tanstack-start: minor
---

## Compile Payload components and their assets

Fig TanStack Start now turns stylesheet imports in named `.server.ts` and
`.server.tsx` components into Payload asset dependencies automatically. These
compiled styles use the existing Payload row ownership, dedupe, streaming, and
reveal-gating behavior without requiring an `assets(stylesheet(...))` wrapper.

Ordinary components imported into those server modules are now isomorphic
components automatically: they render during SSR and hydrate in the browser.
The generated per-bundle manifest owns module resolution, stable component
identity, and client CSS metadata, so applications no longer author
`clientReference`, `createPayloadClientReferenceResolver`, ids, or dynamic
imports. It follows Vite's resolved module and chunk graphs without a
filesystem scan or process-global registry.
