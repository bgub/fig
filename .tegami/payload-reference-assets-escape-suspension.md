---
packages:
  npm:@bgub/fig:
    replay:
      - exit-prerelease(npm:@bgub/fig)
---

## Deliver client-reference assets outside the resolution suspension

A decoded client reference's asset declarations now attach above its
module-load and reveal-gate suspension points. A server document render
that hits a cold reference module emits the island's stylesheet with the
segment containing the reference instead of with the late fill, so
first-request asset ordering matches warm requests.
