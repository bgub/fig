---
packages:
  npm:@bgub/fig:
    replay:
      - exit-prerelease(npm:@bgub/fig)
  npm:@bgub/fig-dom:
    replay:
      - exit-prerelease(npm:@bgub/fig-dom)
  npm:@bgub/fig-server:
    replay:
      - exit-prerelease(npm:@bgub/fig-server)
---

## Publish metadata only with its visible owner

Title and meta resources now travel through Payload as owner-bound
declarations and update the document only when their decoded tree commits.
Pending or superseded refreshes keep the previous metadata visible.

Streaming HTML now treats Suspense fallbacks as metadata owners and reconciles
the completed visible metadata snapshot in the boundary reveal operation.
Partial segments and failed or abandoned primary work cannot mutate the head.

The obsolete `onAssetError` option and its asset-diagnostic types are removed:
late metadata is delivered with its owner instead of being dropped.
