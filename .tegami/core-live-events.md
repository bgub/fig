---
packages:
  "@bgub/fig-reconciler":
    type: patch
---

## Preserve stable-event lifetime under reentrant cleanup

Publish each stable-event invocation before aborting its predecessor, and publish retirement before running unmount abort listeners. Reentrant calls now receive the correct signal and remain tracked for cleanup. Revealing an Activity no longer revives stable events or effects inside descendants that are still hidden.
