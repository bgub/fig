---
packages:
  "@bgub/fig": patch
  "@bgub/fig-dom": patch
  "@bgub/fig-reconciler": patch
  "@bgub/fig-server": patch
  "@bgub/fig-tanstack-router": patch
  "@bgub/fig-vite": minor
  "@bgub/fig-tanstack-start": patch
---

## Let Fig's Vite integration own runtime configuration

The new `fig()` Vite integration defines Fig's development gate and installs
Fast Refresh. TanStack Start composes it automatically, so applications no
longer need to configure Fig's compile-time mode or SSR package bundling
themselves.

`@bgub/fig-vite` now uses the application's Fig DOM renderer as a peer instead
of installing a private renderer copy.

The development gate follows Vite's command rather than its mode: serving
enables development behavior, while builds—including `--mode development`—strip
it from production output.

Published npm packages now expose development artifacts through a Fig-owned
condition, allowing the Vite integration to enable diagnostics and Fast Refresh
for ordinary installs while explicit static overrides remain authoritative and
default production imports retain their previous dead-code elimination. A
static `false` override also disables Fast Refresh instrumentation.
