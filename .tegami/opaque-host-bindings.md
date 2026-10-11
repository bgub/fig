---
packages:
  "@bgub/fig-dom":
    type: minor
---

Make the new `HostBinding<T>` API opaque before its first release. Create host
bindings through `hostBinding()`; ownership, mixin slots, and update callbacks
are private implementation details. Reject structural lookalikes while preserving
element typing, binding composition, and committed lifetime behavior.
