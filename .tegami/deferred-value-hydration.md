---
packages:
  "@bgub/fig-reconciler":
    type: patch
---

## Preserve server DOM when hydrating deferred values

Match Fig's server-rendered current value during hydration even when useDeferredValue has an initial placeholder. Client-only mounts retain their placeholder behavior.
