---
packages:
  "@bgub/fig": minor
  "@bgub/fig-dom": major
---

## Preserve host behavior lifetimes across configuration updates

Add `context.owns(prop)` to identify the last mixin writer of a host prop, even
when a later override writes the same value.

Add `hostBinding(context, owner, update)` for mixins that register committed DOM
configuration. Updates keep their lifetime signal; removal, owner replacement,
and Activity hiding abort it synchronously.

`composeBind` now returns a binding description instead of a callable callback.
Each composed binding has an independent signal and development strict check.
Use `BindCallback` when a callable function is required and `Bind` for the full
binding prop. Existing callback props keep their identity-based lifetime.

Headless widgets adopt shared committed value, registration, and reference owners.
Controlled props cannot leak from suspended renders, accepted uncontrolled
requests compose before commit, and compound Combobox changes cancel together.
Host configuration updates preserve typeahead and toast work while actual
removal cleans up immediately. Caller-authored native disability and accessible
names remain authoritative.
