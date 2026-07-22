---
packages:
  npm:@bgub/fig: minor
  npm:@bgub/fig-dom: minor
  npm:@bgub/fig-reconciler: minor
  npm:@bgub/fig-server: minor
  npm:@bgub/fig-tanstack-start: patch
---

## Promise-valued children render through Suspense

`FigNode` now accepts promises of nodes. Promise children occupy distinct,
host-transparent child slots, suspend through the nearest `Suspense`, and route
rejections or invalid resolved children through normal error handling.

HTML rendering retains exact promise children as independent streaming tasks,
while Payload uses node-validated promise rows that decode to the same child
shape. Payload-rendered async components are invoked once and retain their
component-scoped assets on the outlined row.
