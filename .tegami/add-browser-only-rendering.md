---
packages:
  "@bgub/fig":
    type: patch
  "@bgub/fig-dom":
    type: minor
  "@bgub/fig-reconciler":
    type: patch
  "@bgub/fig-server":
    type: minor
---

## Add intentional browser-only rendering

Components can call `readBrowser(reason?)` to leave their nearest server-rendered
Suspense boundary in its fallback state and render normally during hydration.
Server renderers can observe these intentional fallbacks through
`onBrowserBailout` without treating them as server or recoverable errors.
