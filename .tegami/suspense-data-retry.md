---
packages:
  "@bgub/fig-reconciler":
    type: patch
---

Re-render retained primary content on initial Suspense retries so completed siblings reveal fresh data and install their data and external-store subscriptions.

Rebuild uncommitted host output on retries and only release acquired host ownership, preventing stale props and deletion errors when fresh data changes the primary tree before its first reveal.
