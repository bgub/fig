---
packages:
  npm:@bgub/fig-server: minor
---

## Rename the payload decoding API to `createPayloadConsumer`

`createPayloadResponse` is now `createPayloadConsumer`, and the returned
object is a `PayloadConsumer` (options: `PayloadConsumerOptions`). The old
name described the object as a response when it is the long-lived decoding
end of the payload wire: it ingests many HTTP responses over its lifetime,
holds decode caches and boundary state, and re-renders a bound root.

The standalone `fetchPayload(response, input, options?)` function is now a
method: `consumer.fetch(input, options?)`. Behavior is unchanged — it sends
the consumer codec in `Accept`, sends `refreshBoundary` via
`PAYLOAD_BOUNDARY_HEADER`, rejects non-2xx with `PayloadFetchError`, and
resolves after the body is fully ingested.

Both changes are breaking renames with no compatibility aliases; migrate by
renaming call sites.
