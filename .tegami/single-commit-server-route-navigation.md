---
packages:
  npm:@bgub/fig: patch
  npm:@bgub/fig-start: patch
---

## Server-route navigations commit content in one pass

Navigating to a payload server route used to commit an empty slot for one
retry beat (stretched to the full animation length when a view transition
was running) before the content revealed, because three already-settled
promises still suspended on their first render read:

- payload element gates are now tracked at creation, so a gate that settles
  before its first read resolves synchronously;
- fig-start's client-reference module resolutions are tracked the same way;
- fig-start's pre-commit `prepare()` now reveals the island hydration gate,
  so navigations mount real islands instead of paying a placeholder →
  reveal follow-up commit.

The route swap now lands as a single commit containing the full decoded
content, so view transitions capture the destination page with its content
already present.
