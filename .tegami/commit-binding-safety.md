---
packages:
  "@bgub/fig-dom":
    type: patch
  "@bgub/fig-reconciler":
    type: patch
---

## Keep binding errors and hydration requests attached to the right commit

Attribute deferred binding errors to the declaring asset owner when multiple components share a hoisted element. Preserve ownership through metadata winner changes as well as asset acquisition and updates.

Queue event-triggered hydration until an active commit finishes instead of re-entering its render attempt. Bind and layout callbacks can focus or click a dehydrated boundary without corrupting the commit; queued replayable events still dispatch once after hydration.
