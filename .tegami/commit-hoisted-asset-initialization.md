---
packages:
  "@bgub/fig-dom":
    type: patch
  "@bgub/fig-reconciler":
    type: patch
---

Keep shared hoisted assets unchanged during suspended renders. Acquire from the latest retry props at commit, preserving existing delivery-asset definitions and deduplicating assets inserted while rendering was suspended.

Hoisted host acquisition now owns initial props and text; generic host initialization no longer writes to potentially shared instances.

Keep declared client binds and event listeners when adopting an existing server or payload asset, without rewriting its live attributes or attaching callbacks from suspended work.

Index existing head assets to avoid repeated full scans when acquiring distinct assets, while preserving discovery of same-turn external DOM changes.
