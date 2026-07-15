---
packages:
  npm:@bgub/fig: patch
  npm:@bgub/fig-dom: patch
  npm:@bgub/fig-server: minor
---

## Make stylesheet precedence deterministic

Stylesheets now use one precedence-then-href order across server output, late
streaming, payload insertion, and host rendering. Stream timing and discovery
order no longer determine the cascade.
