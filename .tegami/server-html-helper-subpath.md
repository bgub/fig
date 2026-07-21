---
packages:
  npm:@bgub/fig: patch
  npm:@bgub/fig-server: major
  npm:@bgub/fig-tanstack-start: patch
---

## Move HTML escaping helpers to a focused subpath

`escapeAttribute`, `escapeText`, `escapeScriptText`, and `escapeScriptJson` now export from
`@bgub/fig-server/html` instead of the main `@bgub/fig-server` entry.
The dedicated subpath keeps companion-markup helpers separate from server
render entry points while preserving their exact escaping behavior. The
TanStack Start adapter now consumes these helpers, Fig's internal data-store
brand predicate, and its own storage-context API instead of duplicating them.
