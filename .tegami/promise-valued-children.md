---
packages:
  npm:@bgub/fig: minor
  npm:@bgub/fig-dom: minor
  npm:@bgub/fig-reconciler: patch
  npm:@bgub/fig-server: minor
---

## Support promise-valued children

Promises are now valid `FigNode` children. Client rendering and HTML SSR read
them through Suspense while preserving hydration-stable text seams, and payload
rendering outlines them as lazy node rows. Promise-valued props remain ordinary
promise rows. HTML and payload server renderers also support async components;
client components may pass through stable promises, while development rejects
components that create a new promise on every render.
