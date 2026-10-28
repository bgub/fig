---
packages:
  "@bgub/fig":
    type: major
  "@bgub/fig-reconciler":
    type: major
  "@bgub/fig-dom":
    type: major
  "@bgub/fig-server":
    type: major
---

Remove `partition` from `createDataStore` and `dataPartition` from client and server renderer options. Each store already owns an isolated cache, so the fixed key prefix provided no additional isolation. Remove these options from callers; include tenant identity in resource keys when one store holds data for multiple tenants. SSR hydration entries remain unchanged.
