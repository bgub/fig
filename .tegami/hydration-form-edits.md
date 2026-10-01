---
packages:
  "@bgub/fig-dom": minor
  "@bgub/fig-reconciler": patch
---

### Preserve pre-hydration form edits with explicit state adoption

Hydration automatically preserves edits to uncontrolled inputs, textareas, checkboxes, radios, and selects. Controlled fields preserve edits when they declare the new `adoptFormState((node, signal) => ...)` mixin and synchronously adopt live browser state; otherwise hydration applies application state. Binding abstractions can compose the mixin with their setter and native listeners. It preserves native event timing: no inferred input/change/click events are dispatched.

Edit detection uses the browser-normalized SSR baseline, including textarea children and select defaults. Untouched fields take client initial state; checkbox/radio adoption waits for activation or cancellation to settle. Synchronous adoption updates and re-entrant flushSync calls protect other pending fields. Callback errors report globally without clearing the tree or stopping other adopters.
