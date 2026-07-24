---
packages:
  npm:@bgub/fig-dom:
    replay:
      - exit-prerelease(npm:@bgub/fig-dom)
---

## Make `configureDomRefreshScheduler` internal

The `@bgub/fig-dom/refresh` subpath now exports only `scheduleRefresh`
and the `RefreshFamily`/`RefreshUpdate` types. The wiring setter was
called by exactly one place — fig-dom's own renderer, as a module side
effect — and HMR runtimes only ever needed `scheduleRefresh`. The
before-main-entry update buffering is unchanged and keeps living in a
single shared module, so pre-evaluation refreshes still replay once the
renderer configures itself.
