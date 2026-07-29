---
packages:
  "@bgub/fig":
    type: minor
  "@bgub/fig-dom":
    type: minor
  "@bgub/fig-reconciler":
    type: minor
---

## Allow interactive transitions to interrupt native animations

`transition()` and the function returned by `useTransition()` now accept
`viewTransition: "interrupt"`. When another native View Transition is already
animating, Fig skips it, waits for its cleanup to settle, and immediately
commits the latest rendered state, starting a new transition when that commit
has participating boundaries. The default remains serialized so navigations
and streamed reveals retain uninterrupted motion. Interruptible DOM
transitions also drop the implicit full-page snapshot so controls outside
explicit transition surfaces stay live and can express the next intent by
pointer before the current animation finishes.
