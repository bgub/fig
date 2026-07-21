---
packages:
  npm:@bgub/fig: patch
  npm:@bgub/fig-dom: minor
---

## Serialized components move to the data-resource model

Serialized trees are now ordinary data resources: servers return plain
Payload streams, and clients consume them through keyed `dataResource`
instances with `payloadDataLoader`. Refresh is `refreshData`, navigation can
select a new key, and back/forward navigations reuse cached entries. Commits
wait for the incoming Payload, island modules, and stylesheet gates.

Supporting API additions: `payloadDataLoader` accepts a `prepareAssets`
override (defaults to `insertAssetResources`), and `decodePayloadStream`
accepts an `onClientReference` observer for reference metadata.
