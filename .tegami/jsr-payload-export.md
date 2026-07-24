---
packages:
  npm:@bgub/fig:
    replay:
      - exit-prerelease(npm:@bgub/fig)
---

## Expose the payload decoder on JSR

The JSR manifest now exports `@bgub/fig/payload`, matching the npm package
and making the browser-safe payload decoder available from both registries.
