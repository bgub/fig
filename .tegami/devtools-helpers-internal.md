---
packages:
  npm:@bgub/fig-reconciler: minor
---

## `@bgub/fig-reconciler/devtools` is now type-only

`devtoolsTypeName` and `getFigDevtoolsGlobalHook` were reconciler
implementation helpers, not part of the DevTools protocol; both moved
to an internal module. The subpath now exposes exactly the protocol and
snapshot types (`FigDevtoolsGlobalHook`, `FigDevtools*Snapshot`, ...).
DevTools frontends define their own hook accessor against the
`FigDevtoolsGlobalHook` shape, which is unchanged.
