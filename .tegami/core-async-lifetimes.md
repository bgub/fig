---
packages:
  "@bgub/fig-reconciler":
    type: patch
---

## Preserve async run ownership through abort callbacks and Activity hiding

Publish transition and action run ownership before invoking predecessor abort listeners, so reentrant starts retain their results and pending slots retire correctly. Saved starters and action runners called while hidden or unmounted now receive aborted signals without acquiring update authority or pending slots; revealing their owner restores normal behavior.
