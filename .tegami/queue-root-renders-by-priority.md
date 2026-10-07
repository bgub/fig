---
packages:
  "@bgub/fig-reconciler":
    type: patch
---

## Preserve root render priority during urgent updates

Queue and rebase root renders by lane, so urgent child updates cannot expose pending transition props. Preserve skipped root updates across render restarts and keep later synchronous root renders authoritative when deferred work resumes.
