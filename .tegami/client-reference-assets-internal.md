---
packages:
  npm:@bgub/fig: minor
---

## Drop the `clientReferenceAssets` helper from the main entry

The runtime helper `clientReferenceAssets(reference)` (read a client
reference's declared assets, resolving thunks) had two homes; it is now
exported only from `@bgub/fig/internal`, where its consumers — the payload
serializer and framework manifest plumbing — already import it. Apps
declare assets with `clientReference({ assets })` and never call the
helper. The `ClientReferenceAssets` type stays on the main entry because
it appears in the public `ClientReferenceOptions.assets` signature.
