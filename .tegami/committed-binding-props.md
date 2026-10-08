---
packages:
  "@bgub/fig-dom": patch
---

## Apply host properties before updating bindings

Run callback and host bindings after the host's attributes and form properties
have been applied. Widgets now follow form reassociation through later mixins,
removing the old form's reset listener and registering with the new form.
