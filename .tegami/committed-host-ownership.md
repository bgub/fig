---
packages:
  "@bgub/fig": minor
  "@bgub/fig-dom": minor
---

## Preserve host behavior lifetimes across configuration updates

Add `context.owns(prop)` to identify the last mixin writer of a host prop, even
when a later override writes the same value.

Add `hostBinding(context, owner, update)` for mixins that register committed DOM
configuration. Updates keep their lifetime signal; removal, owner replacement,
and Activity hiding abort it synchronously.

The host `bind` prop additionally accepts host-binding descriptions and nested
binding arrays through the new `Binding` type. Array members have independent
signals and development strict checks. `Bind` remains callable, and
`composeBind` preserves its callable result and shared lifetime semantics.
`BindCallback` is an alias for `Bind`.

Headless widgets adopt shared committed value, registration, and reference owners.
Controlled props cannot leak from suspended renders, accepted uncontrolled
requests compose before commit, and compound Combobox changes cancel together.
Host configuration updates preserve typeahead and toast work while actual
removal cleans up immediately. Caller-authored native disability and accessible
names remain authoritative.
