---
packages:
  "@bgub/fig-tanstack-start":
    type: patch
---

## Initialize server request storage synchronously

Remove top-level await and Node detection from Start request-storage initialization so service-worker builds can supply a `node:async_hooks` adapter without rewriting generated code. Preserve Node's async request isolation and resolve browser storage imports to a separate inert module. Single-slot worker adapters still require application-owned serialization through full response-body consumption.
