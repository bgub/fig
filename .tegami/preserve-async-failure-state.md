---
packages:
  "@bgub/fig":
    type: patch
---

Prevent automatic refresh loops when a data loader rejects with an undefined reason. Cache failures thrown while subscribing to a thenable, and preserve its first settlement across duplicate callbacks or subsequent throws.
