---
packages:
  npm:@bgub/fig: minor
---

## Remove the `FigText` type alias

`FigText` was a two-member alias (`string | number`) whose only use was
as a constituent of the `FigNode` union; no signature anywhere took it
by name. The union now spells out `string | number` directly, and the
alias is gone from both the main and internal entries. Code that
referenced `FigText` should use `string | number` (or `FigNode` where
the full children type is meant).
