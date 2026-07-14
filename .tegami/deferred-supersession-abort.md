---
packages:
  npm:@bgub/fig: minor
---

## Supersession abort waits for the successor's value

Refreshing a fulfilled data-resource entry no longer aborts the previous
generation's signal when the new load starts. Authority transfers when the
successor's value publishes: the visible stale value keeps streaming through
the refresh window (payload holes keep filling), subscribers re-render onto
the new tree in the same pass the old generation retires in, and a failed
refresh leaves the previous generation fully alive — stale value usable,
live holes included. Value-less pending loads still abort immediately when
superseded, and hydrate-over/eviction/disposal still end every generation.

This closes the gap where refreshing a serialized-component resource while
its holes were still streaming surfaced "Payload decode aborted." through
the nearest ErrorBoundary — cancellation now stays retirement, never a user
error, for plain consumers too.
