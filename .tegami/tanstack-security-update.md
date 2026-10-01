---
packages:
  "@bgub/fig-tanstack-router": patch
  "@bgub/fig-tanstack-start": patch
---

Update the TanStack Router and Start integrations to the latest stable cores, including Start Server Core 1.169.39's fix for GHSA-qx66-fv34-fjm8. Adapt SSR script rendering to Router Core's initial hydration tags and stream boundary, preserve exact link search matching and explicit undefined values with the new comparison API, and update History and Store dependencies.

Let browser bundles discard server-only adapter branches and reuse native attribute normalization for route asset resources and positioned tags.
