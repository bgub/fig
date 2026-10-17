---
packages:
  "@bgub/fig":
    type: major
  "@bgub/fig-dom":
    type: major
  "@bgub/fig-reconciler":
    type: major
  "@bgub/fig-server":
    type: major
---

Preserve partition ownership across data snapshots, initial data, hydration, and
Payload streams. Reject mismatched or missing labels before accepting private
data or Payload content. Partitioned Payload streams now begin with a partition
row, and explicit decoders must provide the matching `dataPartition` option.
Fig DOM Payload components obtain that expectation from their owning store.

Unpartitioned producers and consumers retain their existing behavior. Upgrade
partitioned producers and consumers together; manually constructed hydration
entries must carry their originating partition. Replace the root/store on an
account or authorization-scope change to retire old data and in-flight work.
