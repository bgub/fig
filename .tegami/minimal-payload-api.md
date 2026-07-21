---
packages:
  npm:@bgub/fig: minor
  npm:@bgub/fig-dom: minor
  npm:@bgub/fig-server: minor
---

## Payload exposes rendering and decoding, not its implementation

The payload packages now present two primary operations:
`renderToPayloadStream` on the server and `decodePayloadStream` in the
browser-safe core entry. Row/model types, value encoding, codec machinery,
content-type negotiation helpers, and framework document transports are
internal implementation details.

Client references use one `resolveClientReference(reference)` seam that may
return a component synchronously or asynchronously. It replaces the separate
load, resolve, and observation callbacks; reference metadata now includes its
stream-safe assets. The unused `load` field is also removed from
`clientReference(...)` declarations.

`payloadDataLoader` keeps only `request`, `resolveClientReference`, and the
optional `prepareAssets` override. Payload encoding is fixed internally rather
than exposed as a speculative custom-codec interface.
