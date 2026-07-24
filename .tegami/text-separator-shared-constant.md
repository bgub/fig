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

## Share the text-separator protocol constant; small DOM cleanups

The `<!--,-->` text-separator comment the server writes between adjacent text
fibers was hardcoded independently by the server renderer and fig-dom's
hydration cursor. The comment data now lives in `@bgub/fig/internal` as
`TEXT_SEPARATOR_DATA`, next to the other streaming protocol constants, so the
two sides cannot drift. No wire change — the emitted markup is identical.

fig-dom also drops an unused internal `rootFor` helper, routes style clearing
through the shared `isEmptyPropValue` predicate, and simplifies a redundant
branch in select-value syncing. No behavior change.
