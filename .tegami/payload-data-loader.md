---
packages:
  npm:@bgub/fig: minor
  npm:@bgub/fig-dom: minor
---

## Generation-lifetime loader signals and `payloadDataLoader`

Data-resource loader signals now live as long as their load's generation,
not just the pending promise: the `{ signal }` a loader receives stays
unaborted after the value lands and aborts when the generation loses
authority — a newer load supersedes it, a server push hydrates over it, the
entry evicts, or the store is disposed. A rejected load's own signal aborts
on settlement, and `invalidateData` never aborts (marking stale does not
revoke authority). Loaders that stream into their value in the background —
payload decodes filling holes — tie that work to the signal; plain fetch
loaders are unaffected.

The load context also carries an internal, generation-guarded hydration
capability (symbol-keyed; read through `@bgub/fig/internal`) that hydrates
server-pushed `data` rows through the calling store only while the load is
authoritative, skipping rows that target the loading entry's own key.

New in `@bgub/fig-dom`: `payloadDataLoader({ request,
resolveClientReference?, prepareAssets? })` adapts a payload-stream
endpoint into an ordinary data-resource loader. It validates the response
(status, body, payload codec content-type; unusable bodies are cancelled),
wires `decodePayloadStream` to the generation-lifetime signal, hydrates
`data` rows through the store capability, inserts stream-discovered assets
with `insertAssetResources` (stylesheet gates delay only dependent reveal),
and resolves with the decoded root value — so `readData(postResource, slug)`
suspends like any read and returns renderable elements while streamed holes
keep filling in the background.
