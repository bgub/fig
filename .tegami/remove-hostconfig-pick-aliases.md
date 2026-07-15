---
packages:
  npm:@bgub/fig-reconciler: minor
---

## Remove `HostRenderConfig` and `HostValidationConfig`

Both were plain `Pick<HostConfig, ...>` regroupings with no consumers
and no enforcement value. The capability types stay: those are
coherent host method groups for renderers that implement them. Their
`Required<Pick<...>>` portions express complete required method sets,
while intersections preserve deliberately optional notifications such
as `commitHydratedInstance`. `HostPortalConfig` describes the optional
portal lifecycle pair; portals themselves use the core mutation methods.
Hosts that referenced the removed aliases should use
`Pick<HostConfig, ...>` inline or `HostConfig` itself.
