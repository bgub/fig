---
packages:
  "@bgub/fig-reconciler":
    type: patch
---

Retain pending data reads while a suspended transition preserves its previous screen. Push-only watches now survive the discarded render attempt and can publish the value that resumes the transition, instead of repeatedly evicting and retrying. Release those holds on completion or boundary removal without cancelling other readers or callers.
