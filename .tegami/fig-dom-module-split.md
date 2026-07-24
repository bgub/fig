---
packages:
  npm:@bgub/fig-dom:
    replay:
      - exit-prerelease(npm:@bgub/fig-dom)
---

## Split fig-dom's oversized modules into focused ones

Internal restructuring with no API or behavior change. The host config and
renderer wiring move out of the package entry into `renderer.ts`; form
control value/checked/select handling, style application, the `on()` event
descriptor, and the propagation-state patching each get their own module.
Event slot attachment state is now a discriminated union instead of four
nullable fields.
