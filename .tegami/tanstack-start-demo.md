---
packages:
  npm:@bgub/fig: patch
  npm:@bgub/fig-dom: patch
  npm:@bgub/fig-reconciler: minor
  npm:@bgub/fig-server: patch
  npm:@bgub/fig-tanstack-router: patch
---

## Preserve framework-managed asset placement

Framework adapters can now keep externally managed head and body tags in their
declared positions without exposing a DOM prop. TanStack Router uses this for
route-managed links, styles, and scripts while continuing to map title and meta
entries through Fig asset resources. Full-document hydration now ignores the
doctype and one shared marker identifies every server-owned node without a
client fiber. Declarative asset lists also gain a client commit lifecycle, so
route titles and metadata update during navigation.
