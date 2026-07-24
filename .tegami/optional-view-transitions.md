---
packages:
  npm:@bgub/fig-dom: minor
  npm:@bgub/fig-reconciler: minor
---

## Make DOM View Transitions explicitly optional

`enableViewTransitions()` from `@bgub/fig-dom/view-transitions` explicitly
activates native DOM View Transitions, including after roots exist. Applications
that omit the optional entry exclude both the reconciler planner and browser
adapter from their bundles.

Renderer authors can install the optional View Transition planner through the
new single-owner commit-coordinator seam. Coordinator types preserve the host's
container and instance identities, while a private type-only contract keeps the
planner's fiber and root views aligned with the reconciler.
