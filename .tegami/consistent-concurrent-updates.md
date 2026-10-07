---
packages:
  "@bgub/fig-reconciler":
    type: patch
---

## Prevent torn external snapshots and partial Suspense updates

Validate external-store snapshots before concurrent commits, including yielded work completed by flushSync and parked commits. Retry inconsistent snapshots before publishing host mutations, and route subscription snapshot errors through render error boundaries.

Preserve skipped transition lanes across Suspense retries and urgent reveals so related updates cannot commit partially or become stranded.
