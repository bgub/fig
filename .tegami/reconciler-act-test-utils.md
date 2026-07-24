---
packages:
  npm:@bgub/fig-reconciler:
    replay:
      - exit-prerelease(npm:@bgub/fig-reconciler)
  npm:@bgub/fig-dom:
    replay:
      - exit-prerelease(npm:@bgub/fig-dom)
---

## Move `act` to `@bgub/fig-reconciler/test-utils`

`act` is testing infrastructure, not renderer construction, so it moves
off the main entry onto a `./test-utils` subpath — the same shape as
`@bgub/fig-dom/test-utils`. DOM tests keep importing `act` from
`@bgub/fig-dom/test-utils`; renderer tests now import it from
`@bgub/fig-reconciler/test-utils`. Behavior is unchanged; the subpath
shares the scheduler instance with the main entry.
