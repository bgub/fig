---
packages:
  "@bgub/fig":
    type: patch
  "@bgub/fig-reconciler":
    type: patch
---

Hold data entries for every render read, not only reads of pending loads.
Committing a render swaps the hold for a subscription; discarding one releases
it and re-arms inactive cleanup, and a suspended subtree's Suspense boundary
holds every key its content read until it reveals. Abandoned renders no longer
leave entries cached indefinitely, and parked or suspended renders keep their
values, including hydrate-only ones, without reloading.
