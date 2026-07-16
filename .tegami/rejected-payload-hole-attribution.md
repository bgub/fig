---
packages:
  npm:@bgub/fig: minor
  npm:@bgub/fig-dom: patch
---

## Attribute rejected payload holes to their data resource

Payload hole errors are attributed to the authoritative owning data-resource
generation. Error boundaries receive `dataResourceKeys`, and
`invalidateDataError` retires the broken fulfilled value before retrying so a
remounted boundary suspends on fresh content instead of immediately catching
the same rejected hole. `decodePayloadStream` also exposes an observational
`onHoleError` callback.

The load context's hydration capability now shares the same authority window:
a still-visible generation's `data` rows keep hydrating through a superseding
refresh's window instead of being dropped the moment the refresh starts.
