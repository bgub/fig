---
packages:
  npm:@bgub/fig:
    replay:
      - exit-prerelease(npm:@bgub/fig)
  npm:@bgub/fig-server:
    replay:
      - exit-prerelease(npm:@bgub/fig-server)
---

## The targeted-refresh protocol and payload consumer are gone

The serialized-components deletion gate passed across the demo e2e suites,
so the legacy architecture is removed rather than deprecated:

- `@bgub/fig-server/payload` no longer exports `createPayloadConsumer`,
  `PayloadConsumer`, `PayloadBoundary`, `PAYLOAD_BOUNDARY_HEADER`,
  `PayloadFetchError`, or the consumer fetch/ingestion seam, and
  `renderToPayloadStream` drops its `refreshBoundary` option.
- The wire format loses the `refresh`/`refresh-error` rows and the
  `$fig:"boundary"` model: the refresh unit is the data-resource key that
  delivers the payload, so refreshing is requesting the same stream again.

Replacements, all already shipping: `decodePayloadStream` in
`@bgub/fig/payload` is the client half; fig-dom's `payloadDataLoader`
delivers a serialized tree as an ordinary data resource; the freshness
verbs (`refreshData`/`invalidateData`) are the refresh story; sub-tree
refresh granularity is finer resource keys.
