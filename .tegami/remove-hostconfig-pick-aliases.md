---
packages:
  npm:@bgub/fig-reconciler: minor
---

## Remove `HostRenderConfig` and `HostValidationConfig`

Both were plain `Pick<HostConfig, ...>` regroupings with no consumers
and no enforcement value. The capability types stay: those are
`Required<Pick<...>>` aliases that gate a feature — implementing the
whole group is what enables hydration, activity, suspense hydration, or
portals — which plain `HostConfig` optionality cannot express. Hosts
that referenced the removed aliases should use `Pick<HostConfig, ...>`
inline or `HostConfig` itself.
