---
packages:
  npm:@bgub/fig: patch
  npm:@bgub/fig-dom: patch
  npm:@bgub/fig-server: patch
---

## Bound stalled view-transition waits

Transition-eligible commits and annotated streaming reveals now wait at most 60
seconds for a previous browser View Transition. If its completion promise never
settles, Fig releases the document mutex and proceeds with the latest work
instead of parking it forever.
