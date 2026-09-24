---
packages:
  "@bgub/fig-reconciler": patch
---

## Preserve stable-event visibility when Suspense shows a fallback

Re-index hook owners preserved under a hidden Suspense primary so their stable
events become inactive during commit. This fixes a development parity error when
already-rendered content suspends, while preserving handlers and DOM nodes for
reveal and keeping callbacks from discarded renders unpublished.
