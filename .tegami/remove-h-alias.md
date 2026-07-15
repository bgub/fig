---
packages:
  npm:@bgub/fig: minor
---

## Remove the `h` alias for `createElement`

`@bgub/fig` no longer exports `createElement` under the second name `h`.
Every export has one home and one name; migrate by importing
`createElement` (or alias it locally: `const h = createElement`).
