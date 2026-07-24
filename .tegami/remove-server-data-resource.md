---
packages:
  npm:@bgub/fig:
    replay:
      - exit-prerelease(npm:@bgub/fig)
  npm:@bgub/fig-vite:
    replay:
      - exit-prerelease(npm:@bgub/fig-vite)
---

## Use one data-resource API in every environment

`dataResource` now covers shared, browser, and server-only loaders without a
second API. Server-only loaders belong behind the framework's server module
boundary; browser code uses an explicit key-only resource when it needs the
same hydrated value.

The pass-through `serverDataResource` API, `@bgub/fig/server` entry point,
`figData` Vite transform, and generated browser resource stubs are removed.
