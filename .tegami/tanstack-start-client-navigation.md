---
packages:
  npm:@bgub/fig-dom: patch
  npm:@bgub/fig-reconciler: patch
  npm:@bgub/fig-tanstack-start: patch
---

## Fix first-load styling and development client navigation

Keep TanStack Start's compiler-sensitive client modules out of Vite dependency
prebundling so client navigation uses the client server-function transport
instead of executing server-only context access in the browser. Preserve
browser-extension roots appended to document singletons during hydration so a
third-party node cannot trigger document replacement and remove stylesheets.
