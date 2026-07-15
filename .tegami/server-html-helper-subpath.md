---
packages:
  npm:@bgub/fig-server: major
---

## Move HTML escaping helpers to a focused subpath

`escapeAttribute` and `escapeText` now export from
`@bgub/fig-server/html` instead of the main `@bgub/fig-server` entry.
The dedicated subpath keeps companion-markup helpers separate from server
render entry points while preserving their exact escaping behavior.
