---
packages:
  npm:@bgub/fig: minor
  npm:@bgub/fig-dom: major
---

## Compose host behavior with mixins

Core now exports `createMixin()` and resolves render-time host behavior through
the `mix` prop. Mixins may contribute host props or nested mixins while keeping
the host type and subtree fixed.

DOM event listeners now use `mix={on(type, callback)}`. Migrate
`events={[on(type, callback)]}` to `mix={on(type, callback)}`; multiple or
conditional descriptors move into `mix={[...]}` and preserve positional
listener identity.
