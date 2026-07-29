---
packages:
  "@bgub/fig-tanstack-start": patch
---

## Reduce the TanStack Start production SSR graph

The private default server entry now composes TanStack's handler with a shared
Fig renderer module. This keeps Payload response rendering and its compiled
application-reference manifest out of the production SSR service without
adding another public package entrypoint.
